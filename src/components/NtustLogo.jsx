/**
 * 國立臺灣科技大學校徽（向量版）
 * ------------------------------------------------------------------
 * 以 SVG 重繪，不依賴外部圖檔，任何尺寸都保持銳利。
 *
 *   variant="seal"  完整校徽（含環狀中英文校名），適合登入頁等大尺寸
 *   variant="mark"  只有中央徽記，適合導覽列等小尺寸
 *
 *   tone="color"    校徽原色（藍底白字）
 *   tone="mono"     單色描邊版，底色透明，適合疊在深色背景上
 */

const NTUST_BLUE = '#0b5ea8'
const CN_NAME = '國立臺灣科技大學'
const EN_NAME = 'National Taiwan University of Science and Technology'

export default function NtustLogo({
  size = 40,
  variant = 'mark',
  tone = 'color',
  color = NTUST_BLUE,
  title = CN_NAME,
}) {
  const mono = tone === 'mono'
  // ink = 主色（外圈底、中央徽記）；paper = 襯色（環線、校名、內圈）
  const ink = mono ? 'none' : color
  const paper = mono ? color : '#fff'
  const emblemFill = color
  const uid = `ntust-${variant}-${tone}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      style={{ display: 'block', flex: 'none' }}
    >
      <title>{title}</title>

      {variant === 'seal' && (
        <defs>
          {/* 上半圈：9 點鐘方向順時針繞過頂端到 3 點鐘方向 */}
          <path id={`${uid}-top`} d="M 31,100 A 69,69 0 0 1 169,100" fill="none" />
          {/* 下半圈：9 點鐘方向逆時針繞過底端到 3 點鐘方向 */}
          <path id={`${uid}-bottom`} d="M 24,100 A 76,76 0 0 0 176,100" fill="none" />
        </defs>
      )}

      {/* 外圈 */}
      <circle cx="100" cy="100" r="99" fill={ink} stroke={mono ? color : 'none'} strokeWidth={mono ? 3 : 0} />
      <circle cx="100" cy="100" r={variant === 'seal' ? 93 : 90} fill="none" stroke={paper} strokeWidth="2.5" />

      {variant === 'seal' ? (
        <>
          <circle cx="100" cy="100" r="57" fill={mono ? 'none' : paper} stroke={mono ? color : 'none'} strokeWidth={mono ? 2.5 : 0} />

          <text
            fill={paper}
            fontSize="21"
            fontWeight="700"
            letterSpacing="1.2"
            fontFamily="'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif"
          >
            <textPath href={`#${uid}-top`} startOffset="50%" textAnchor="middle">
              {CN_NAME}
            </textPath>
          </text>

          <text fill={paper} fontSize="8.2" fontWeight="600" fontFamily="'Segoe UI',system-ui,sans-serif">
            <textPath
              href={`#${uid}-bottom`}
              startOffset="50%"
              textAnchor="middle"
              textLength="215"
              lengthAdjust="spacingAndGlyphs"
            >
              {EN_NAME}
            </textPath>
          </text>

          {/* 左右兩側的分隔點 */}
          <circle cx="20" cy="100" r="3.2" fill={paper} />
          <circle cx="180" cy="100" r="3.2" fill={paper} />

          <Emblem fill={emblemFill} scale={0.8} />
        </>
      ) : (
        <>
          <circle cx="100" cy="100" r="78" fill={mono ? 'none' : paper} />
          <Emblem fill={emblemFill} scale={1.15} />
        </>
      )}
    </svg>
  )
}

/**
 * 中央徽記：六角螺帽（校徽的機械意象），下方延伸為雙腳柱身。
 * 以 (100,100) 為中心等比縮放，兩種尺寸共用。
 */
function Emblem({ fill, scale = 1 }) {
  // 螺帽孔用 evenodd 鏤空，這樣原色版與單色版都能正確露出底色
  const outline =
    'M 100,48 L 133,67 L 133,105 L 117,114.2 L 117,152 L 100,161.8 L 100,121.5 L 83,111.7 L 83,152 L 67,142.8 L 67,67 Z'
  const bolt = 'M 100,68 a 17,17 0 1,0 0.1,0 Z'

  return (
    <g transform={`translate(100 100) scale(${scale}) translate(-100 -100)`}>
      <path d={`${outline} ${bolt}`} fill={fill} fillRule="evenodd" />
    </g>
  )
}

export { NTUST_BLUE }
