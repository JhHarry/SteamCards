interface LogoProps {
  size?: number;
}

/** 应用图标：炭黑底 + 叠放的两张卡牌（陶土色 / 象牙白），中央一颗菱形暗扣。 */
export default function Logo({ size = 28 }: LogoProps) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <defs>
          <linearGradient id="sc-logo-bg" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#302823" />
            <stop offset="1" stopColor="#16120f" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14.4" fill="url(#sc-logo-bg)" />
        <g transform="rotate(-15 27 31)">
          <rect x="14" y="12" width="24" height="34" rx="3.2" fill="#b7613d" />
        </g>
        <g transform="rotate(9 37 35)">
          <rect x="24" y="15" width="25" height="37" rx="3.4" fill="#f2eadf" />
          <path d="M36.5 32.7l4.3 4.3-4.3 4.3-4.3-4.3z" fill="#c05c38" />
        </g>
      </svg>
    </span>
  );
}
