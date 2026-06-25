/**
 * WebFetch tool — fetch web content and return text, markdown, html, or images.
 *
 * Inspired by opencode's webfetch tool. The handler uses Effect's HttpClient so
 * callers can provide a real fetch layer or a deterministic test client.
 */
import { Tool } from 'effect/unstable/ai'
import { Effect, Match, Schema } from 'effect'
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from 'effect/unstable/http'
import { Parser } from 'htmlparser2'
import TurndownService from 'turndown'

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000

export class WebFetchError extends Schema.TaggedErrorClass<WebFetchError>()(
  'WebFetchError',
  {
    url: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number),
    retryable: Schema.Boolean,
  }
) {}

const WebFetchFormat = Schema.Literals(['text', 'markdown', 'html'])
type WebFetchFormat = typeof WebFetchFormat.Type

const acceptHeader = (format: WebFetchFormat): string =>
  Match.value(format).pipe(
    Match.when(
      'markdown',
      () =>
        'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1'
    ),
    Match.when(
      'text',
      () => 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1'
    ),
    Match.when(
      'html',
      () =>
        'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1'
    ),
    Match.exhaustive
  )

const validateUrl = (url: string) =>
  Effect.try({
    try: () => new URL(url),
    catch: () =>
      new WebFetchError({
        url,
        message: 'URL must be fully formed and start with http:// or https://.',
        retryable: false,
      }),
  }).pipe(
    Effect.filterOrFail(
      (parsed) => parsed.protocol === 'http:' || parsed.protocol === 'https:',
      () =>
        new WebFetchError({
          url,
          message: 'URL must start with http:// or https://.',
          retryable: false,
        })
    )
  )

const isImageAttachment = (mime: string): boolean =>
  mime.startsWith('image/') && mime !== 'image/svg+xml'

const timeoutMillis = (timeoutSeconds: number | undefined) =>
  Math.min((timeoutSeconds ?? DEFAULT_TIMEOUT_MS / 1000) * 1000, MAX_TIMEOUT_MS)

const contentTypeMime = (contentType: string): string =>
  contentType.split(';')[0]?.trim().toLowerCase() ?? ''

const statusCode = (
  error: HttpClientError.HttpClientError
): number | undefined =>
  error.reason._tag === 'StatusCodeError'
    ? error.reason.response.status
    : undefined

const toWebFetchError = (
  url: string,
  error: HttpClientError.HttpClientError
) => {
  const status = statusCode(error)
  const message =
    status === undefined
      ? 'Web request failed.'
      : `Web request failed with HTTP ${status}.`
  return new WebFetchError({
    url,
    message,
    ...(status !== undefined ? { status } : {}),
    retryable: status === undefined || status === 429 || status >= 500,
  })
}

const formatContent = (
  format: WebFetchFormat,
  contentType: string,
  content: string
): string =>
  Match.value(format).pipe(
    Match.when('markdown', () =>
      contentType.includes('text/html')
        ? convertHtmlToMarkdown(content)
        : content
    ),
    Match.when('text', () =>
      contentType.includes('text/html') ? extractTextFromHtml(content) : content
    ),
    Match.when('html', () => content),
    Match.exhaustive
  )

export const WebFetch = Tool.make('WebFetch', {
  description:
    'Fetch content from a fully formed http(s) URL. Returns markdown by default; can also return plain text or raw HTML. Images are returned as data URLs. Read-only and does not modify files.',
  parameters: Schema.Struct({
    url: Schema.String.annotate({
      description:
        'Fully formed URL to fetch. Must start with http:// or https://.',
    }),
    format: Schema.optionalKey(WebFetchFormat).annotate({
      description: 'Output format: markdown (default), text, or html.',
    }),
    timeout: Schema.optionalKey(Schema.Number).annotate({
      description:
        'Optional timeout in seconds. Maximum 120 seconds; default 30 seconds.',
    }),
  }),
  success: Schema.String,
  failure: WebFetchError,
  failureMode: 'return',
  dependencies: [HttpClient.HttpClient],
})

export const WebFetchHandler = {
  WebFetch: ({
    url,
    format = 'markdown',
    timeout,
  }: {
    readonly url: string
    readonly format?: WebFetchFormat | undefined
    readonly timeout?: number | undefined
  }) =>
    Effect.gen(function* () {
      const parsedUrl = yield* validateUrl(url)
      const http = yield* HttpClient.HttpClient
      const httpOk = HttpClient.filterStatusOk(http)
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        Accept: acceptHeader(format),
        'Accept-Language': 'en-US,en;q=0.9',
      }

      const request = HttpClientRequest.get(parsedUrl.toString()).pipe(
        HttpClientRequest.setHeaders(headers)
      )

      const response = yield* httpOk.execute(request).pipe(
        Effect.catchIf(
          (error) =>
            error.reason._tag === 'StatusCodeError' &&
            error.reason.response.status === 403 &&
            error.reason.response.headers['cf-mitigated'] === 'challenge',
          () =>
            httpOk.execute(
              HttpClientRequest.get(parsedUrl.toString()).pipe(
                HttpClientRequest.setHeaders({
                  ...headers,
                  'User-Agent': 'sorato',
                })
              )
            )
        ),
        Effect.catch((error) => Effect.fail(toWebFetchError(url, error))),
        Effect.timeoutOrElse({
          duration: timeoutMillis(timeout),
          orElse: () =>
            Effect.fail(
              new WebFetchError({
                url,
                message: 'Web request timed out.',
                retryable: true,
              })
            ),
        })
      )

      const contentLength = response.headers['content-length']
      if (
        contentLength !== undefined &&
        Number.parseInt(contentLength, 10) > MAX_RESPONSE_SIZE
      ) {
        return yield* Effect.fail(
          new WebFetchError({
            url,
            message: 'Response too large (exceeds 5MB limit).',
            retryable: false,
          })
        )
      }

      const arrayBuffer = yield* response.arrayBuffer.pipe(
        Effect.catch((error) => Effect.fail(toWebFetchError(url, error)))
      )
      if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
        return yield* Effect.fail(
          new WebFetchError({
            url,
            message: 'Response too large (exceeds 5MB limit).',
            retryable: false,
          })
        )
      }

      const contentType = response.headers['content-type'] ?? ''
      const mime = contentTypeMime(contentType)
      const title = `${parsedUrl.toString()} (${contentType})`

      if (isImageAttachment(mime)) {
        const base64 = Buffer.from(arrayBuffer).toString('base64')
        return `# ${title}\n\nImage fetched successfully.\n\nData URL: data:${mime};base64,${base64}`
      }

      const content = new TextDecoder().decode(arrayBuffer)
      return `# ${title}\n\n${formatContent(format, contentType, content)}`
    }).pipe(
      Effect.annotateLogs({
        package: 'core',
        subsystem: 'tool',
        tool: 'WebFetch',
      }),
      Effect.withLogSpan('tool.WebFetch')
    ),
}

export const extractTextFromHtml = (html: string): string => {
  let text = ''
  let skipDepth = 0

  const parser = new Parser({
    onopentag(name) {
      if (
        skipDepth > 0 ||
        ['script', 'style', 'noscript', 'iframe', 'object', 'embed'].includes(
          name
        )
      ) {
        skipDepth++
      }
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })

  parser.write(html)
  parser.end()

  return text.trim()
}

export const convertHtmlToMarkdown = (html: string): string => {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  })
  turndown.remove(['script', 'style', 'meta', 'link'])
  return turndown.turndown(html)
}
