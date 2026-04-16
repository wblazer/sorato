/**
 * Sessions group handler implementation.
 *
 * Delegates to SessionStorage from @agents/agent. The handler Layer requires
 * SessionStorage in its environment — the caller provides it (e.g. SqliteSession).
 */
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Fiber, Match } from "effect";
import { SessionStorage, type SessionStorageApi } from "../session/session.ts";
import {
  Api,
  MessageNodeResponse,
  RunResponse,
  SessionResponse,
  StopResponse,
} from "./api.ts";
import { ensureModel } from "./model-catalog.ts";
import { runAgent } from "./run-agent.ts";
import {
  clearActiveFiber,
  drainQueuedRuns as drainQueuedInputs,
  enqueueRun,
  getFiber,
  isRunning,
  requestStop,
  registerActiveFiber,
  registerWorkerFiber,
  releaseRun,
  shouldStop,
  shiftQueuedRun,
} from "./run-registry.ts";
import { publish } from "./event-bus.ts";

const toSessionResponse = (s: {
  readonly id: string;
  readonly directory: string;
  readonly model: string;
  readonly title: string | null;
  readonly headId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}) => {
  const status = Match.value(isRunning(s.id)).pipe(
    Match.when(true, () => "running" as const),
    Match.orElse(() => "idle" as const),
  );

  return new SessionResponse({
    id: s.id,
    directory: s.directory,
    model: s.model,
    title: s.title,
    headId: s.headId,
    status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  });
};

const toMessageNodeResponse = (m: {
  readonly id: string;
  readonly sessionId: string;
  readonly parentId: string | null;
  readonly encoded: unknown;
  readonly createdAt: number;
}) =>
  new MessageNodeResponse({
    id: m.id,
    sessionId: m.sessionId,
    parentId: m.parentId,
    encoded: m.encoded,
    createdAt: m.createdAt,
  });

const registerActiveRun = Effect.fn("Sessions.registerActiveRun")(
  (sessionId: string, fiber: Fiber.Fiber<void, never>) =>
    Effect.suspend(() => doRegisterActiveRun(sessionId, fiber)),
);

const clearActiveRun = Effect.fn("Sessions.clearActiveRun")(
  (sessionId: string) => Effect.suspend(() => doClearActiveRun(sessionId)),
);

const releaseQueuedRun = Effect.fn("Sessions.releaseQueuedRun")(
  (sessionId: string) => Effect.suspend(() => doReleaseQueuedRun(sessionId)),
);

const registerRunWorker = Effect.fn("Sessions.registerRunWorker")(
  (sessionId: string, fiber: Fiber.Fiber<void, never>) =>
    Effect.suspend(() => doRegisterRunWorker(sessionId, fiber)),
);

const requestRunStop = Effect.fn("Sessions.requestRunStop")(
  (sessionId: string) => Effect.suspend(() => doRequestRunStop(sessionId)),
);

const drainQueuedInputsNow = Effect.fn("Sessions.drainQueuedInputs")(
  (sessionId: string) => Effect.suspend(() => Effect.succeed(drainQueuedInputs(sessionId))),
);

const publishMessagesAppended = Effect.fn("Sessions.publishMessagesAppended")(
  (sessionId: string) => Effect.suspend(() => doPublishMessagesAppended(sessionId)),
);

const doRegisterActiveRun = (
  sessionId: string,
  fiber: Fiber.Fiber<void, never>,
) => {
  registerActiveFiber(sessionId, fiber);
  return Effect.void;
};

const doClearActiveRun = (sessionId: string) => {
  clearActiveFiber(sessionId);
  return Effect.void;
};

const doReleaseQueuedRun = (sessionId: string) => {
  releaseRun(sessionId);
  return Effect.void;
};

const doRegisterRunWorker = (
  sessionId: string,
  fiber: Fiber.Fiber<void, never>,
) => {
  registerWorkerFiber(sessionId, fiber);
  return Effect.void;
};

const doRequestRunStop = (sessionId: string) => {
  requestStop(sessionId);
  return Effect.void;
};

const doPublishMessagesAppended = (sessionId: string) => {
  publish({ _tag: "MessagesAppended", sessionId });
  return Effect.void;
};

function createRunWorker(sessionId: string) {
  const clearActive = clearActiveRun(sessionId);
  const releaseRunNow = releaseQueuedRun(sessionId);

  return Effect.gen(function* () {
    while (true) {
      const stopRequested = shouldStop(sessionId);
      if (stopRequested) break;

      const input = shiftQueuedRun(sessionId);
      if (!input) break;

      const fiber = yield* Effect.forkDetach(runAgent(sessionId, input));
      yield* registerActiveRun(sessionId, fiber);

      const joinedFiber = Fiber.join(fiber);
      yield* joinedFiber.pipe(Effect.ensuring(clearActive));
    }
  }).pipe(Effect.ensuring(releaseRunNow));
}

function startRunWorker(sessionId: string) {
  const onWorkerError = releaseQueuedRun(sessionId);

  return Effect.forkDetach(createRunWorker(sessionId)).pipe(
    Effect.tap((fiber) => registerRunWorker(sessionId, fiber)),
    Effect.map(() => new RunResponse({ status: "started" as const })),
    Effect.onError(() => onWorkerError),
  );
}

const selectRunResponse = (sessionId: string, status: "queued" | "started") =>
  ({
    queued: queuedRunResponse,
    started: startRunWorker(sessionId),
  })[status];

function stopWithoutActiveFiber(storage: SessionStorageApi, sessionId: string) {
  const isSessionRunning = Number(isRunning(sessionId));
  const notRunningResponse = Effect.succeed(
    new StopResponse({ status: "not_running" }),
  );
  const runningResponse = Effect.gen(function* () {
    const queuedInputs = yield* drainQueuedInputsNow(sessionId);
    const appendedQueuedInputs = storage
      .append(
        sessionId,
        queuedInputs.map((input) => ({
          role: "user" as const,
          content: input,
        })),
      )
      .pipe(Effect.tap(() => publishMessagesAppended(sessionId)));
    const appendQueuedInputs =
      [Effect.void, appendedQueuedInputs][Number(queuedInputs.length > 0)] ??
      Effect.void;

    yield* appendQueuedInputs;
    return new StopResponse({ status: "stopped" });
  });

  return [notRunningResponse, runningResponse][isSessionRunning] ?? notRunningResponse;
}

const stopWithActiveFiber = Effect.fn("Sessions.stopWithActiveFiber")(
  function* (
    storage: SessionStorageApi,
    sessionId: string,
    fiber: Fiber.Fiber<void, never>,
  ) {
    // Interrupt the running fiber and wait for it to finish.
    // The fiber's uninterruptible cleanup persists partial
    // assistant content before terminating, so the system message
    // we append below is guaranteed to come AFTER the partial turn.
    yield* Fiber.interrupt(fiber);

    const queuedInputs = yield* drainQueuedInputsNow(sessionId);

    // Persist a system message so the LLM knows it was interrupted
    // on the next turn.
    yield* storage.append(sessionId, [
      {
        role: "system" as const,
        content:
          "[The user interrupted the previous response. The assistant message above may be incomplete.]",
      },
      ...queuedInputs.map((input) => ({
        role: "user" as const,
        content: input,
      })),
    ]);
    yield* publishMessagesAppended(sessionId);

    return new StopResponse({ status: "stopped" });
  },
);

const stopSession = Effect.fn("Sessions.stopSession")(
  function* (storage: SessionStorageApi, sessionId: string) {
    yield* requestRunStop(sessionId);
    const fiber = getFiber(sessionId);
    const stopEffect = Match.value(fiber).pipe(
      Match.when(undefined, () => stopWithoutActiveFiber(storage, sessionId)),
      Match.orElse((fiber) => stopWithActiveFiber(storage, sessionId, fiber)),
    );

    return yield* stopEffect;
  },
);

const queuedRunResponse = Effect.succeed(
  new RunResponse({ status: "queued" as const }),
);

export const SessionsLive = HttpApiBuilder.group(Api, "sessions", (handlers) =>
  Effect.gen(function* () {
    const storage = yield* SessionStorage;

    return handlers
      .handle("list", () =>
        storage
          .list()
          .pipe(Effect.map((sessions) => sessions.map(toSessionResponse))),
      )
      .handle("create", ({ payload }) =>
        ensureModel(payload.directory, payload.model).pipe(
          Effect.andThen(
            storage.create(payload.directory, payload.model, payload.title),
          ),
          Effect.map(toSessionResponse),
        ),
      )
      .handle("get", ({ params }) =>
        storage.get(params.id).pipe(Effect.map(toSessionResponse)),
      )
      .handle("delete", ({ params }) => storage.delete(params.id))
      .handle("leaves", ({ params }) =>
        storage
          .leaves(params.id)
          .pipe(Effect.map((nodes) => nodes.map(toMessageNodeResponse))),
      )
      .handle("messages", ({ params }) =>
        storage
          .messages(params.id)
          .pipe(Effect.map((nodes) => nodes.map(toMessageNodeResponse))),
      )
      .handle("setModel", ({ params, payload }) =>
        storage.get(params.id).pipe(
          Effect.flatMap((session) =>
            ensureModel(session.directory, payload.model),
          ),
          Effect.andThen(storage.setModel(params.id, payload.model)),
          Effect.andThen(storage.get(params.id)),
          Effect.map(toSessionResponse),
        ),
      )
      .handle("run", ({ params, payload }) =>
        storage.get(params.id).pipe(
          Effect.flatMap(() =>
            selectRunResponse(params.id, enqueueRun(params.id, payload.input)),
          ),
        ),
      )
      .handle("stop", ({ params }) => stopSession(storage, params.id));
  }),
);
