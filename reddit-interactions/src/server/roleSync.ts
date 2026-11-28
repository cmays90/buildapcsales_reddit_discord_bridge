import {reddit} from '@devvit/web/server'
import {
  CATCH_ALL_DISCORD_ROLE_NAME,
  CATCH_ALL_ROLE_NAME,
  createPickerMessage,
  discordRoleNameForFlair,
  ensureRoleIds,
  getPickerState,
  type PickerOption,
  pinMessage,
  updatePickerOptions,
} from './discord.ts'
import {logWarn} from './log.ts'

/** Discord string-select components cap at 25 options. */
const MAX_PICKER_OPTIONS = 25

/** Placeholder text for a role-picker message the bot creates itself. */
const PICKER_PLACEHOLDER = 'Choose notification categories'

/**
 * Caps the option list at Discord's 25-option select-menu limit, keeping the
 * alphabetically first ones. Returns whether truncation happened so the
 * caller can log it.
 */
export function clampOptions(options: readonly PickerOption[]): {
  options: PickerOption[]
  truncated: boolean
} {
  if (options.length <= MAX_PICKER_OPTIONS)
    return {options: [...options], truncated: false}
  const sorted = [...options].sort((a, b) => a.label.localeCompare(b.label))
  return {options: sorted.slice(0, MAX_PICKER_OPTIONS), truncated: true}
}

/**
 * Compares the picker's current options against the desired set (by role
 * id). Returns the new option list if they differ, `undefined` if the
 * picker already matches — so the caller can skip a no-op PATCH.
 */
export function diffOptions(
  current: readonly PickerOption[],
  desired: readonly PickerOption[],
): PickerOption[] | undefined {
  const currentIds = new Set(current.map(o => o.value))
  const desiredIds = new Set(desired.map(o => o.value))
  const sameIds =
    currentIds.size === desiredIds.size &&
    [...currentIds].every(id => desiredIds.has(id))
  const sameLabels = current.every(c => {
    const match = desired.find(d => d.value === c.value)
    return match !== undefined && match.label === c.label
  })
  if (sameIds && sameLabels) return undefined
  return [...desired]
}

/**
 * Ensures a Discord role exists for every post flair currently on the
 * subreddit (plus the always-offered catch-all role), then keeps the pinned
 * role-picker message's options in sync with that same set — adding roles
 * for new flairs and pruning options for flairs that no longer exist.
 * Never touches which roles a member already holds.
 *
 * If `pickerMessageId` is missing, or points at a message that's been
 * deleted, a new picker message is created and pinned in its place. Returns
 * the message id actually used so the caller can persist a newly-created one,
 * plus the full roleName -> id map so the caller can refresh the cache
 * postAnnouncement reads from instead of hitting Discord on every post.
 */
export async function syncFlairRoles(opts: {
  subredditName: string
  guildId: string
  pickerChannelId: string
  pickerMessageId: string | undefined
  botToken: string
}): Promise<{pickerMessageId: string; roleIds: Record<string, string>}> {
  const {subredditName, guildId, pickerChannelId, pickerMessageId, botToken} =
    opts

  const templates = await reddit.getPostFlairTemplates(subredditName)
  const flairNames = [
    ...new Set(
      templates.map(t => t.text).filter((text): text is string => !!text),
    ),
  ]
  const desired = [
    {label: CATCH_ALL_ROLE_NAME, roleName: CATCH_ALL_DISCORD_ROLE_NAME},
    ...flairNames.map(name => ({
      label: name,
      roleName: discordRoleNameForFlair(name),
    })),
  ]
  const resolvedIds = await ensureRoleIds(
    guildId,
    botToken,
    desired.map(d => d.roleName),
  )
  // ensureRoleIds returns one id per input name, same order (see its doc
  // comment), so this index always lands on a real value.
  const roleIds = Object.fromEntries(
    desired.map(({roleName}, i) => [roleName, resolvedIds[i] as string]),
  )
  const desiredOptions = desired.map(({label, roleName}) => ({
    label,
    value: roleIds[roleName] as string,
  }))

  const {options: clamped, truncated} = clampOptions(desiredOptions)
  if (truncated) {
    logWarn('role picker truncated: too many flairs', {
      subreddit: subredditName,
      flairCount: desiredOptions.length,
      limit: MAX_PICKER_OPTIONS,
    })
  }

  if (pickerMessageId) {
    const current = await getPickerState(
      pickerChannelId,
      pickerMessageId,
      botToken,
    )
    if (current) {
      const next = diffOptions(current.options, clamped)
      if (next) {
        await updatePickerOptions(
          pickerChannelId,
          pickerMessageId,
          botToken,
          next,
          current.placeholder,
        )
      }
      return {pickerMessageId, roleIds}
    }
    logWarn('role picker message missing; recreating', {
      subreddit: subredditName,
      pickerChannelId,
      pickerMessageId,
    })
  }

  const newMessageId = await createPickerMessage(
    pickerChannelId,
    botToken,
    clamped,
    PICKER_PLACEHOLDER,
  )
  await pinMessage(pickerChannelId, newMessageId, botToken)
  return {pickerMessageId: newMessageId, roleIds}
}
