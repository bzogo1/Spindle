"use client"

export function NymMixnetDiagram() {
  return (
    <section className="nym-diagram-section" aria-labelledby="nym-title">
      <div className="nym-wrap">
        <div className="nym-header">
          <div className="nym-logo">NYM</div>
          <h2 id="nym-title" className="nym-title">
            NOISE GENERATING MIXNET
          </h2>
        </div>
        <div className="nym-stage">
          <svg
            className="nym-svg"
            viewBox="0 0 916 482"
            aria-labelledby="nym-svg-title nym-desc"
            role="img"
          >
            <title id="nym-svg-title">Noise Generating Mixnet</title>
            <desc id="nym-desc">
              A client laptop sends indistinguishable Sphinx packets through an entry gateway into
              the Nym Mixnet (data mixing plus timing obfuscation), out through an exit gateway as
              anonymized packets, to the web.
            </desc>

            {/* Title underline rule */}
            <line x1="60" y1="128" x2="856" y2="128" stroke="#2a332d" strokeWidth="1" />

            {/* ===== CLIENT (laptop) ===== */}
            <g className="nym-node" transform="translate(60, 270)">
              {/* base */}
              <path
                d="M 6 120 L 64 120 L 70 110 L 0 110 Z"
                fill="#121512"
                stroke="#4c554d"
                strokeWidth="1"
              />
              {/* body */}
              <path
                d="M 0 110 L 82 110 L 86 22 L 0 22 Z"
                fill="#0f1211"
                stroke="#4c554d"
                strokeWidth="1"
              />
              {/* screen */}
              <rect
                x="6"
                y="28"
                width="72"
                height="82"
                fill="#0b0e0c"
                stroke="#4c554d"
                strokeWidth="1"
              />
              {/* screen glow / NYM */}
              <rect
                x="16"
                y="38"
                width="52"
                height="64"
                fill="none"
                stroke="#14e76f"
                strokeWidth="1.2"
                opacity="0.95"
              />
              <text
                x="52"
                y="74"
                fontFamily="'IBM Plex Mono', monospace"
                fontSize="15"
                fontWeight="800"
                fill="#14e76f"
                textAnchor="middle"
                letterSpacing="2"
              >
                NYM
              </text>
              {/* keyboard hint */}
              <rect
                x="14"
                y="96"
                width="56"
                height="6"
                fill="#121512"
                stroke="#4c554d"
                strokeWidth="1"
              />
            </g>
            <text x="106" y="392" textAnchor="middle" className="nym-label">
              CLIENT
            </text>

            {/* connection line client -> entry (y=300) */}
            <line x1="158" y1="300" x2="329" y2="300" stroke="#4c554d" strokeWidth="1.5" />
            {/* cover traffic dots */}
            <circle cx="229" cy="300" r="4" fill="#14e76f" />
            <circle cx="274" cy="300" r="4" fill="#14e76f" />

            {/* bracket + label: Indistinguishable Sphinx packets */}
            <path
              d="M 140 272 Q 140 240 300 240"
              fill="none"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <path
              d="M 140 328 Q 140 360 300 360"
              fill="none"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <line
              x1="140"
              y1="240"
              x2="140"
              y2="252"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <line
              x1="300"
              y1="240"
              x2="300"
              y2="252"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <line
              x1="140"
              y1="360"
              x2="140"
              y2="348"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <line
              x1="300"
              y1="360"
              x2="300"
              y2="348"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <text x="220" y="224" textAnchor="middle" className="nym-caption">
              Indistinguishable
            </text>
            <text x="220" y="240" textAnchor="middle" className="nym-caption">
              Sphinx packets
            </text>

            {/* ===== ENTRY GATEWAY ===== */}
            <g className="nym-node" transform="translate(329, 270)">
              <rect
                x="0"
                y="0"
                width="56"
                height="26"
                rx="2"
                fill="#161b19"
                stroke="#4c554d"
                strokeWidth="1"
              />
              <rect x="4" y="4" width="48" height="10" fill="#3a443a" />
              <rect
                x="0"
                y="32"
                width="56"
                height="26"
                rx="2"
                fill="#161b19"
                stroke="#4c554d"
                strokeWidth="1"
              />
              <rect x="4" y="36" width="48" height="10" fill="#3a443a" />
              <rect
                x="0"
                y="64"
                width="56"
                height="26"
                rx="2"
                fill="#161b19"
                stroke="#4c554d"
                strokeWidth="1"
              />
              <rect x="4" y="68" width="48" height="10" fill="#3a443a" />
              <rect
                x="0"
                y="96"
                width="56"
                height="26"
                rx="2"
                fill="#161b19"
                stroke="#4c554d"
                strokeWidth="1"
              />
              <rect x="4" y="100" width="48" height="10" fill="#3a443a" />
            </g>
            <text x="357" y="420" textAnchor="middle" className="nym-label">
              Entry Gateway
            </text>

            {/* connection line entry -> mixnet left diamond tip (368) */}
            <line x1="385" y1="300" x2="368" y2="300" stroke="#4c554d" strokeWidth="1.5" />

            {/* ===== MIXNET (center diamond mesh) ===== */}
            <g className="nym-node" transform="translate(368, 254)">
              {/* outer diamond */}
              <path
                d="M 92 0 L 184 46 L 92 92 L 0 46 Z"
                fill="none"
                stroke="#4c554d"
                strokeWidth="1.5"
                opacity="0.5"
              />
              {/* connecting mesh lines (green) */}
              <g stroke="#14e76f" strokeWidth="1.1" opacity="0.95">
                {/* outer diamond */}
                <line x1="55" y1="9" x2="129" y2="9" />
                <line x1="55" y1="46" x2="129" y2="46" />
                <line x1="55" y1="83" x2="129" y2="83" />
                <line x1="55" y1="9" x2="55" y2="83" />
                <line x1="92" y1="9" x2="92" y2="83" />
                <line x1="129" y1="9" x2="129" y2="83" />
                {/* diamond diagonals (weave) */}
                <line x1="55" y1="9" x2="129" y2="83" />
                <line x1="129" y1="9" x2="55" y2="83" />
                <line x1="55" y1="46" x2="92" y2="9" />
                <line x1="129" y1="46" x2="92" y2="9" />
                <line x1="55" y1="46" x2="92" y2="83" />
                <line x1="129" y1="46" x2="92" y2="83" />
                <line x1="92" y1="9" x2="55" y2="46" />
                <line x1="92" y1="9" x2="129" y2="46" />
                <line x1="92" y1="83" x2="55" y2="46" />
                <line x1="92" y1="83" x2="129" y2="46" />
              </g>
              {/* nodes (green dots) - 3x3 grid centered local (92,46) */}
              <g fill="#14e76f">
                <circle cx="55" cy="9" r="3.5" />
                <circle cx="92" cy="9" r="3.5" />
                <circle cx="129" cy="9" r="3.5" />
                <circle cx="55" cy="46" r="4" />
                <circle cx="92" cy="46" r="4" fill="#d8f7a6" />
                <circle cx="129" cy="46" r="4" />
                <circle cx="55" cy="83" r="3.5" />
                <circle cx="92" cy="83" r="3.5" />
                <circle cx="129" cy="83" r="3.5" />
              </g>
            </g>
            <text x="460" y="420" textAnchor="middle" className="nym-label">
              MIXNET
            </text>

            {/* box above mixnet: Data mixing + Timing obfuscation */}
            <rect
              x="378"
              y="98"
              width="164"
              height="40"
              rx="4"
              fill="#121512"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.9"
            />
            <text x="460" y="114" textAnchor="middle" className="nym-caption">
              Data mixing
              <tspan className="nym-sign"> + </tspan>
              Timing
            </text>
            <text x="460" y="130" textAnchor="middle" className="nym-caption">
              obfuscation
            </text>
            {/* lines from box bottom converging to mixnet top diamond tip (460, 254) */}
            <line
              x1="432"
              y1="138"
              x2="460"
              y2="254"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.6"
            />
            <line
              x1="460"
              y1="138"
              x2="460"
              y2="254"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.6"
            />
            <line
              x1="488"
              y1="138"
              x2="460"
              y2="254"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.6"
            />

            {/* ===== EXIT GATEWAY ===== */}
            <g className="nym-node" transform="translate(560, 270)">
              <rect
                x="0"
                y="0"
                width="56"
                height="26"
                rx="2"
                fill="#161b19"
                stroke="#4c554d"
                strokeWidth="1"
              />
              <rect x="4" y="4" width="48" height="10" fill="#3a443a" />
              <rect
                x="0"
                y="32"
                width="56"
                height="26"
                rx="2"
                fill="#161b19"
                stroke="#4c554d"
                strokeWidth="1"
              />
              <rect x="4" y="36" width="48" height="10" fill="#3a443a" />
              <rect
                x="0"
                y="64"
                width="56"
                height="26"
                rx="2"
                fill="#161b19"
                stroke="#4c554d"
                strokeWidth="1"
              />
              <rect x="4" y="68" width="48" height="10" fill="#3a443a" />
              <rect
                x="0"
                y="96"
                width="56"
                height="26"
                rx="2"
                fill="#161b19"
                stroke="#4c554d"
                strokeWidth="1"
              />
              <rect x="4" y="100" width="48" height="10" fill="#3a443a" />
            </g>
            <text x="588" y="420" textAnchor="middle" className="nym-label">
              Exit Gateway
            </text>

            {/* connection line mixnet right diamond tip (552) -> exit gateway */}
            <line x1="552" y1="300" x2="560" y2="300" stroke="#4c554d" strokeWidth="1.5" />
            {/* connection line exit -> web (y=300) */}
            <line x1="616" y1="300" x2="780" y2="300" stroke="#4c554d" strokeWidth="1.5" />
            {/* anonymized traffic dots */}
            <circle cx="626" cy="300" r="4" fill="#14e76f" />
            <circle cx="651" cy="300" r="4" fill="#14e76f" />
            <circle cx="677" cy="300" r="4" fill="#14e76f" />
            <circle cx="703" cy="300" r="4" fill="#14e76f" />

            {/* bracket + label: Anonymized packets */}
            <path
              d="M 622 272 Q 622 240 707 240"
              fill="none"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <path
              d="M 622 328 Q 622 360 707 360"
              fill="none"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <line
              x1="622"
              y1="240"
              x2="622"
              y2="252"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <line
              x1="707"
              y1="240"
              x2="707"
              y2="252"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <line
              x1="622"
              y1="360"
              x2="622"
              y2="348"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <line
              x1="707"
              y1="360"
              x2="707"
              y2="348"
              stroke="#6d766e"
              strokeWidth="1"
              opacity="0.8"
            />
            <text x="664" y="224" textAnchor="middle" className="nym-caption">
              Anonymized
            </text>
            <text x="664" y="240" textAnchor="middle" className="nym-caption">
              packets
            </text>

            {/* ===== WEB (globe on pedestal) ===== */}
            <g className="nym-node" transform="translate(780, 260)">
              {/* pedestal */}
              <ellipse
                cx="28"
                cy="82"
                rx="36"
                ry="14"
                fill="#121512"
                stroke="#4c554d"
                strokeWidth="1"
              />
              <rect
                x="8"
                y="72"
                width="40"
                height="16"
                fill="#121512"
                stroke="#4c554d"
                strokeWidth="1"
              />
              <circle cx="28" cy="70" r="1.5" fill="#4c554d" />
              {/* globe */}
              <circle
                cx="28"
                cy="38"
                r="30"
                fill="none"
                stroke="#14e76f"
                strokeWidth="1.1"
                opacity="0.95"
              />
              {/* globe lat/long grid */}
              <g stroke="#14e76f" strokeWidth="0.7" opacity="0.6">
                <circle cx="28" cy="38" r="15" fill="none" />
                <circle cx="28" cy="38" r="23" fill="none" />
                <ellipse cx="28" cy="38" rx="30" ry="11" fill="none" />
                <ellipse cx="28" cy="38" rx="18" ry="11" fill="none" />
                <path d="M 6 38 Q 28 14 50 38" fill="none" />
                <path d="M 6 38 Q 28 62 50 38" fill="none" />
                <path d="M 28 14 Q 16 38 28 62" fill="none" />
                <path d="M 28 14 Q 40 38 28 62" fill="none" />
              </g>
              <circle cx="28" cy="38" r="2" fill="#14e76f" />
            </g>
            <text x="808" y="420" textAnchor="middle" className="nym-label">
              WEB
            </text>
          </svg>
        </div>
      </div>
    </section>
  )
}
