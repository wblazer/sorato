import {
  eslintCompatPlugin,
  type Context,
  type ESTree,
  type Plugin,
  type Rule,
  type Visitor,
} from '@oxlint/plugins'

type SegmentPath = ReadonlyArray<string>

const rule = (
  message: string,
  visitors: (context: Context) => Visitor
): Rule => ({
  meta: {
    type: 'problem',
    docs: { description: message },
  },
  createOnce(context) {
    return visitors(context)
  },
})

const memberPath = (
  node: ESTree.Expression | ESTree.TSTypeName
): SegmentPath | undefined => {
  if (node.type === 'Identifier') return [node.name]
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier'
  ) {
    const objectPath = memberPath(node.object)
    return objectPath ? [...objectPath, node.property.name] : undefined
  }
  if (node.type === 'TSQualifiedName') {
    const leftPath = memberPath(node.left)
    return leftPath ? [...leftPath, node.right.name] : undefined
  }
  return undefined
}

const isMemberPath = (
  node: ESTree.Expression | ESTree.TSTypeName,
  expected: SegmentPath
) => {
  const actual = memberPath(node)
  return (
    actual?.length === expected.length &&
    actual.every((segment, index) => segment === expected[index])
  )
}

const isEffectMember = (
  node: ESTree.Expression,
  names?: ReadonlySet<string>
) => {
  const path = memberPath(node)
  if (!path || path[0] !== 'Effect' || path.length !== 2) return false
  return names ? names.has(path[1] ?? '') : true
}

const isEffectCall = (node: ESTree.Expression, names?: ReadonlySet<string>) =>
  node.type === 'CallExpression' && isEffectMember(node.callee, names)

const isPipeCall = (node: ESTree.Expression) =>
  node.type === 'CallExpression' && isMemberPath(node.callee, ['pipe'])

const isStringLiteral = (
  node: ESTree.Expression
): node is ESTree.StringLiteral =>
  node.type === 'Literal' && typeof node.value === 'string'

const importsEffect = (node: ESTree.ImportDeclaration) =>
  node.source.value === 'effect' ||
  (typeof node.source.value === 'string' &&
    node.source.value.startsWith('effect/'))

const banCall = (path: SegmentPath, message: string) =>
  rule(message, (context) => ({
    CallExpression(node) {
      if (isMemberPath(node.callee, path)) context.report({ node, message })
    },
  }))

const banMember = (path: SegmentPath, message: string) =>
  rule(message, (context) => ({
    MemberExpression(node) {
      if (isMemberPath(node, path)) context.report({ node, message })
    },
  }))

const reportRule = (context: Context, node: ESTree.Node, message: string) =>
  context.report({ node, message })

const hasNestedCall = (
  expressions: ReadonlyArray<ESTree.Expression | ESTree.SpreadElement>,
  predicate: (node: ESTree.Expression) => boolean
) =>
  expressions.some((expression) =>
    expression.type === 'SpreadElement'
      ? predicate(expression.argument)
      : predicate(expression)
  )

const hasEffectStep = (node: ESTree.Expression) => {
  if (isEffectCall(node) || isPipeCall(node)) return true
  if (node.type === 'CallExpression')
    return hasNestedCall(node.arguments, hasEffectStep)
  if (node.type === 'MemberExpression') return hasEffectStep(node.object)
  return false
}

const noNestedEffectCall = rule(
  'Avoid nested Effect calls. Build the inner Effect first, then run one flat pipeline.',
  (context) => ({
    CallExpression(node) {
      if (!isEffectMember(node.callee)) return
      const ignoredInner = new Set(['succeed', 'void'])
      if (
        hasNestedCall(
          node.arguments,
          (arg) =>
            isEffectCall(arg) && !isEffectMember(arg.callee, ignoredInner)
        )
      ) {
        reportRule(
          context,
          node,
          noNestedEffectCall.meta?.docs?.description ?? ''
        )
      }
    },
  })
)

const noPipeLadder = rule(
  'Avoid nested pipe() chains. Refactor into one flat pipeline with a single decision point.',
  (context) => ({
    CallExpression(node) {
      if (!isMemberPath(node.callee, ['pipe'])) return
      if (hasNestedCall(node.arguments, isPipeCall)) {
        reportRule(context, node, noPipeLadder.meta?.docs?.description ?? '')
      }
    },
  })
)

const noNestedEffectGen = rule(
  'Avoid nested Effect.gen. Flatten to a single Effect.gen per method or one flat pipeline.',
  (context) => ({
    CallExpression(node) {
      if (!isMemberPath(node.callee, ['Effect', 'gen'])) return
      let parent = node.parent
      while (parent) {
        if (
          parent.type === 'CallExpression' &&
          isMemberPath(parent.callee, ['Effect', 'gen'])
        ) {
          reportRule(
            context,
            node,
            noNestedEffectGen.meta?.docs?.description ?? ''
          )
          return
        }
        parent = parent.parent
      }
    },
  })
)

const noEffectLadder = rule(
  'Avoid nested Effect combinators. Build context once, then run a single flat pipeline.',
  (context) => ({
    CallExpression(node) {
      const ladderNames = new Set([
        'flatMap',
        'map',
        'andThen',
        'tap',
        'orElse',
      ])
      if (!isEffectMember(node.callee, ladderNames)) return
      if (
        hasNestedCall(node.arguments, (arg) => isEffectCall(arg, ladderNames))
      ) {
        reportRule(context, node, noEffectLadder.meta?.docs?.description ?? '')
      }
    },
  })
)

const noEffectAllStepSequencing = rule(
  'Avoid Effect.all for sequential side-effect steps. Use an explicit linear pipeline.',
  (context) => ({
    CallExpression(node) {
      if (!isMemberPath(node.callee, ['Effect', 'all'])) return
      const options = node.arguments[1]
      if (options?.type !== 'ObjectExpression') return
      const concurrencyOne = options.properties.some(
        (property) =>
          property.type === 'Property' &&
          property.key.type === 'Identifier' &&
          property.key.name === 'concurrency' &&
          property.value.type === 'Literal' &&
          property.value.value === 1
      )
      if (concurrencyOne) {
        reportRule(
          context,
          node,
          noEffectAllStepSequencing.meta?.docs?.description ?? ''
        )
      }
    },
  })
)

const noMatchEffectBranch = rule(
  'Avoid sequencing inside Match/Option branches. Select a value, then run one Effect pipeline outside.',
  (context) => ({
    CallExpression(node) {
      const calleePath = memberPath(node.callee)
      if (
        !calleePath ||
        !(
          (calleePath[0] === 'Match' &&
            ['when', 'orElse'].includes(calleePath[1] ?? '')) ||
          (calleePath[0] === 'Option' && calleePath[1] === 'match')
        )
      ) {
        return
      }
      if (hasNestedCall(node.arguments, hasEffectStep)) {
        reportRule(
          context,
          node,
          noMatchEffectBranch.meta?.docs?.description ?? ''
        )
      }
    },
  })
)

const noReturnNull = rule(
  'Avoid returning null. Use Option.none for absence or Effect.fail for errors.',
  (context) => {
    let hasEffectImport = false

    return {
      before() {
        hasEffectImport = false
      },
      ImportDeclaration(node) {
        if (importsEffect(node)) hasEffectImport = true
      },
      ReturnStatement(node) {
        if (!hasEffectImport) return
        if (node.argument?.type === 'Literal' && node.argument.value === null) {
          reportRule(
            context,
            node.argument,
            noReturnNull.meta?.docs?.description ?? ''
          )
        }
      },
    }
  }
)

const noStringSentinelReturn = rule(
  'Avoid returning string tokens. Return domain values, Option/Either, tagged unions, or real Effect results instead.',
  (context) => {
    let hasEffectImport = false

    return {
      before() {
        hasEffectImport = false
      },
      ImportDeclaration(node) {
        if (importsEffect(node)) hasEffectImport = true
      },
      ReturnStatement(node) {
        if (!hasEffectImport) return
        if (node.argument && isStringLiteral(node.argument)) {
          reportRule(
            context,
            node.argument,
            noStringSentinelReturn.meta?.docs?.description ?? ''
          )
        }
      },
    }
  }
)

const noStringSentinelConst = rule(
  'Avoid string status constants. Use tagged unions, Option/Either, or meaningful domain values.',
  (context) => {
    let hasEffectImport = false

    return {
      before() {
        hasEffectImport = false
      },
      ImportDeclaration(node) {
        if (importsEffect(node)) hasEffectImport = true
      },
      VariableDeclarator(node) {
        if (!hasEffectImport) return
        if (
          node.id.type === 'Identifier' &&
          node.id.name.endsWith('Status') &&
          node.init &&
          isStringLiteral(node.init)
        ) {
          reportRule(
            context,
            node.init,
            noStringSentinelConst.meta?.docs?.description ?? ''
          )
        }
      },
    }
  }
)

const noEffectSyncConsole = rule(
  'Avoid console.* inside Effect.sync. Use Effect.log* or remove the console call.',
  (context) => ({
    CallExpression(node) {
      if (!isMemberPath(node.callee, ['Effect', 'sync'])) return
      const callback = node.arguments[0]
      if (
        callback?.type !== 'ArrowFunctionExpression' &&
        callback?.type !== 'FunctionExpression'
      )
        return
      const body = callback.body
      const checks =
        body.type === 'BlockStatement'
          ? body.body
              .map((statement) =>
                statement.type === 'ExpressionStatement'
                  ? statement.expression
                  : undefined
              )
              .filter((expression) => expression !== undefined)
          : [body]
      if (checks.some(isConsoleCall)) {
        reportRule(
          context,
          node,
          noEffectSyncConsole.meta?.docs?.description ?? ''
        )
      }
    },
  })
)

const isConsoleCall = (node: ESTree.Expression) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  memberPath(node.callee)?.[0] === 'console'

const noDynamicImport = rule(
  'Avoid dynamic imports. Use static imports so dependencies stay explicit.',
  (context) => ({
    ImportExpression(node) {
      reportRule(context, node, noDynamicImport.meta?.docs?.description ?? '')
    },
  })
)

const noEffectTypeAlias = rule(
  'Avoid Effect.Effect type aliases. Keep Effect types on service methods or inline at the call site.',
  (context) => ({
    TSTypeAliasDeclaration(node) {
      if (
        node.typeAnnotation.type === 'TSTypeReference' &&
        isMemberPath(node.typeAnnotation.typeName, ['Effect', 'Effect'])
      ) {
        reportRule(
          context,
          node,
          noEffectTypeAlias.meta?.docs?.description ?? ''
        )
      }
    },
  })
)

const noManualEffectChannels = rule(
  'Avoid manual Effect channel tuples. Let Effect/Layer return types infer from the value you return.',
  (context) => ({
    TSTypeReference(node) {
      const path = memberPath(node.typeName)
      if (
        !path ||
        path.length !== 2 ||
        !['Effect', 'Layer'].includes(path[0] ?? '')
      )
        return
      if ((node.typeArguments?.params.length ?? 0) >= 2) {
        reportRule(
          context,
          node,
          noManualEffectChannels.meta?.docs?.description ?? ''
        )
      }
    },
  })
)

const noModelOverlayCast = rule(
  'Avoid `as` assertions on decoded model flow. Decode with the correct schema type and read fields directly.',
  (context) => ({
    TSAsExpression(node) {
      if (
        node.expression.type === 'CallExpression' &&
        hasEffectStep(node.expression)
      ) {
        reportRule(
          context,
          node,
          noModelOverlayCast.meta?.docs?.description ?? ''
        )
      }
    },
  })
)

const noFromNullableNullishCoalesce = rule(
  'Avoid nullish re-wrap inside Option.fromNullable. Pass the source directly.',
  (context) => ({
    CallExpression(node) {
      if (!isMemberPath(node.callee, ['Option', 'fromNullable'])) return
      const source = node.arguments[0]
      if (source?.type === 'LogicalExpression' && source.operator === '??') {
        reportRule(
          context,
          node,
          noFromNullableNullishCoalesce.meta?.docs?.description ?? ''
        )
      }
    },
  })
)

const noOptionBooleanNormalization = rule(
  'Avoid repeated Option boolean normalization. Normalize once at the schema boundary.',
  (context) => ({
    CallExpression(node) {
      if (!isMemberPath(node.callee, ['Option', 'match'])) return
      if (
        node.arguments.some(
          (argument) =>
            argument.type === 'ObjectExpression' &&
            argument.properties.some(
              (property) =>
                property.type === 'Property' &&
                property.value.type === 'Literal' &&
                typeof property.value.value === 'boolean'
            )
        )
      ) {
        reportRule(
          context,
          node,
          noOptionBooleanNormalization.meta?.docs?.description ?? ''
        )
      }
    },
  })
)

const plugin: Plugin = eslintCompatPlugin({
  meta: { name: 'sorato' },
  rules: {
    'no-dynamic-import': noDynamicImport,
    'no-effect-all-step-sequencing': noEffectAllStepSequencing,
    'no-effect-as': banCall(
      ['Effect', 'as'],
      'Avoid Effect.as. Use Effect.map for value mapping or Effect.asVoid after explicit pipeline steps.'
    ),
    'no-effect-async': banCall(
      ['Effect', 'async'],
      'Avoid Effect.async. Use Stream or structured Effect lifecycles.'
    ),
    'no-effect-bind': banMember(
      ['Effect', 'bind'],
      'Avoid Effect.bind. Use one flat pipeline or one direct top-level Effect.gen.'
    ),
    'no-effect-do': banMember(
      ['Effect', 'Do'],
      'Avoid Effect.Do. Use one flat pipeline or one direct top-level Effect.gen.'
    ),
    'no-effect-ladder': noEffectLadder,
    'no-effect-never': banCall(
      ['Effect', 'never'],
      'Avoid Effect.never. Use Stream or explicit acquire/release lifecycles with teardown.'
    ),
    'no-effect-sync-console': noEffectSyncConsole,
    'no-effect-type-alias': noEffectTypeAlias,
    'no-effect-zip-right': banCall(
      ['Effect', 'zipRight'],
      'Avoid Effect.zipRight for side effects. Use explicit pipeline steps that return real values.'
    ),
    'no-fromnullable-nullish-coalesce': noFromNullableNullishCoalesce,
    'no-manual-effect-channels': noManualEffectChannels,
    'no-match-effect-branch': noMatchEffectBranch,
    'no-model-overlay-cast': noModelOverlayCast,
    'no-nested-effect-call': noNestedEffectCall,
    'no-nested-effect-gen': noNestedEffectGen,
    'no-option-as': banCall(
      ['Option', 'as'],
      'Avoid Option.as. Use Option.map or Option.match and return the value explicitly.'
    ),
    'no-option-boolean-normalization': noOptionBooleanNormalization,
    'no-pipe-ladder': noPipeLadder,
    'no-return-null': noReturnNull,
    'no-runtime-runfork': banCall(
      ['Runtime', 'runFork'],
      'Avoid Runtime.runFork. Use forkScoped, Stream, or runtime-provided layers instead.'
    ),
    'no-string-sentinel-const': noStringSentinelConst,
    'no-string-sentinel-return': noStringSentinelReturn,
  },
})

export default plugin
