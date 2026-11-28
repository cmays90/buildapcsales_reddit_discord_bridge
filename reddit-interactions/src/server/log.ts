export type LogFields = Record<string, string | number | boolean | undefined>

/** Formats `event` plus `fields` into one greppable `key="value"` line, with any `err` field appended after a newline so stack traces stay readable. */
export function formatLog(event: string, fields?: LogFields): string {
  const {err, ...rest} = fields ?? {}
  const pairs = Object.entries(rest)
    .filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined,
    )
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  const head = pairs.length ? `${event} ${pairs.join(' ')}` : event
  return err === undefined ? head : `${head}\n${err}`
}

export function logWarn(event: string, fields?: LogFields): void {
  console.warn(formatLog(event, fields))
}

export function logError(event: string, fields?: LogFields): void {
  console.error(formatLog(event, fields))
}

/** Renders a caught value as the `err` log field: an Error's stack (falling back to its message), or the value's string form. */
export function errorDetail(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err)
}
