import {reddit} from '@devvit/web/server'
import {
  CATCH_ALL_ROLE_NAME,
  ensureRoleId,
  getPickerState,
  type PickerOption,
  updatePickerOptions,
} from './discord.ts'

/** Discord string-select components cap at 25 options. */
const MAX_PICKER_OPTIONS = 25

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
 */
export async function syncFlairRoles(opts: {
  subredditName: string
  guildId: string
  pickerChannelId: string
  pickerMessageId: string
  botToken: string
}): Promise<void> {
  const {subredditName, guildId, pickerChannelId, pickerMessageId, botToken} =
    opts

  const templates = await reddit.getPostFlairTemplates(subredditName)
  const flairNames = [
    ...new Set(
      templates.map(t => t.text).filter((text): text is string => !!text),
    ),
  ]
  const desiredNames = [CATCH_ALL_ROLE_NAME, ...flairNames]

  const desiredOptions = await Promise.all(
    desiredNames.map(async name => ({
      label: name,
      value: await ensureRoleId(guildId, botToken, name),
    })),
  )

  const {options: clamped, truncated} = clampOptions(desiredOptions)
  if (truncated) {
    console.warn(
      `${subredditName} has more than ${MAX_PICKER_OPTIONS} flairs; the role picker can only offer ${MAX_PICKER_OPTIONS}`,
    )
  }

  const current = await getPickerState(
    pickerChannelId,
    pickerMessageId,
    botToken,
  )
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
}
