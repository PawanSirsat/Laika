/**
 * The emoji Space settings offers as a space's icon (D-152, LAI-1311): a
 * curated grid, so picking one is a click and no emoji library ships. Any
 * other emoji can be typed or pasted beside it; the server takes exactly
 * one, whichever way it came.
 *
 * Forty-eight, which the picker draws as six rows of eight (six on a phone):
 * work and building first, then things, people, tech and nature.
 */
export const ICON_EMOJIS: readonly string[] = [
  '🚀',
  '🎯',
  '📈',
  '📊',
  '💡',
  '🔥',
  '⭐',
  '✨',
  '🛠️',
  '🧪',
  '🐛',
  '🧩',
  '🏗️',
  '⚙️',
  '🔒',
  '🔑',
  '📦',
  '📝',
  '📚',
  '🗂️',
  '🗓️',
  '⏱️',
  '📣',
  '💬',
  '👥',
  '🤝',
  '🧠',
  '🤖',
  '💼',
  '🎨',
  '🎬',
  '🎵',
  '💻',
  '📱',
  '🌐',
  '☁️',
  '🛰️',
  '🪐',
  '⚡',
  '💎',
  '🌱',
  '🌍',
  '🍀',
  '🐙',
  '🦊',
  '🐝',
  '🏁',
  '🎉',
];

/** A label for an emoji button: the emoji alone tells a screen reader little. */
export function emojiLabel(emoji: string): string {
  return `Use ${emoji} as the icon`;
}
