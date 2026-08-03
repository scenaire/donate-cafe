// Initials-on-colored-circle fallback for the supporters panel. The drink/
// dessert photo feature is out of scope for now (see
// docs/plans/supporters-panel.md) — `photoUrl` is threaded through already so
// that feature can supersede the fallback later without touching call sites.

const AVATAR_PALETTE = ["var(--sakura)", "var(--sakura-deep)", "var(--matcha)"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export type SupporterAvatarProps = {
  name: string;
  size?: number;
  photoUrl?: string;
};

export default function SupporterAvatar({ name, size = 36, photoUrl }: SupporterAvatarProps) {
  const trimmed = name.trim();
  const isAnonymous = !trimmed || trimmed.toLowerCase() === "anonymous";

  if (photoUrl) {
    return (
      // Avatar source is arbitrary user-supplied/future CDN content, not a static app asset.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoUrl} alt="" className="supporter-avatar" style={{ width: size, height: size }} />
    );
  }

  if (isAnonymous) {
    return (
      <div
        className="supporter-avatar supporter-avatar-anon"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
        aria-hidden="true"
      >
        🌸
      </div>
    );
  }

  const background = AVATAR_PALETTE[hashString(trimmed.toLowerCase()) % AVATAR_PALETTE.length];
  return (
    <div
      className="supporter-avatar"
      style={{ width: size, height: size, background, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initialsFor(trimmed)}
    </div>
  );
}
