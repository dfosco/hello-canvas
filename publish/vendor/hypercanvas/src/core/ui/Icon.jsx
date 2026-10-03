/**
 * Icon — renders icons from multiple sources using namespaced names.
 *
 *   primer/    → Primer Octicons (fill-based)
 *   feather/   → Feather Icons (stroke-based)
 *   iconoir/   → Iconoir (stroke-based, manually registered)
 *   (no prefix) → Custom (folder, prototype, canvas, component, etc.)
 *
 * Usage:
 *   <Icon name="primer/repo" />
 *   <Icon name="feather/flag" size={16} />
 *   <Icon name="iconoir/key-command" size={16} strokeWeight={2} />
 *   <Icon name="prototype" size={14} />
 *   <Icon name="feather/tablet" rotate={90} />
 *   <Icon name="primer/lock" offsetX={1} offsetY={-1} />
 *   <Icon name="feather/arrow-right" flipX />
 */

/* ─── Custom SVG paths (fill-based, no namespace prefix) ─── */

const customIcons = {
  'home': {
    viewBox: '0 0 16 16',
    path: 'M6.906.664a1.749 1.749 0 0 1 2.187 0l5.25 4.2c.415.332.657.835.657 1.367v7.019A1.75 1.75 0 0 1 13.25 15h-3.5a.75.75 0 0 1-.75-.75V9H7v5.25a.75.75 0 0 1-.75.75h-3.5A1.75 1.75 0 0 1 1 13.25V6.23c0-.531.242-1.034.657-1.366l5.25-4.2Zm1.25 1.171a.25.25 0 0 0-.312 0l-5.25 4.2a.25.25 0 0 0-.094.196v7.019c0 .138.112.25.25.25H5.5V8.25a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v5.25h2.75a.25.25 0 0 0 .25-.25V6.23a.25.25 0 0 0-.094-.195Z',
  },
  'folder': {
    viewBox: '0 0 24 24',
    path: 'M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h5.175q.4 0 .763.15t.637.425L12 6h8q.825 0 1.413.588T22 8v10q0 .825-.587 1.413T20 20z',
  },
  'folder-open': {
    viewBox: '0 0 24 24',
    path: 'M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h5.175q.4 0 .763.15t.637.425L12 6h9q.425 0 .713.288T22 7t-.288.713T21 8H7.85q-1.55 0-2.7.975T4 11.45V18l1.975-6.575q.2-.65.738-1.037T7.9 10h12.9q1.025 0 1.613.813t.312 1.762l-1.8 6q-.2.65-.737 1.038T19 20z',
  },
  // CollageFrame icon (from PrototypeEmbed widget title bar)
  'prototype': {
    viewBox: '0 0 24 24',
    strokePaths: [
      'M19.4 20H4.6C4.26863 20 4 19.7314 4 19.4V4.6C4 4.26863 4.26863 4 4.6 4H19.4C19.7314 4 20 4.26863 20 4.6V19.4C20 19.7314 19.7314 20 19.4 20Z',
      'M11 12V4',
      'M4 12H20',
    ],
  },
  // Smiley face icon (from assets/icons/canvas.svg)
  'canvas': {
    viewBox: '0 0 28 23',
    strokeRect: { x: 1, y: 1, width: 26, height: 21, rx: 7 },
    fillPaths: [
      'M17.8421 12.9776V12.9788L17.8409 12.9812C18.2386 12.451 18.9901 12.3434 19.5204 12.7409C20.0506 13.1385 20.1582 13.8901 19.7606 14.4204L18.8008 13.7008C19.7416 14.4064 19.7606 14.4209 19.7606 14.4215L19.7583 14.4239C19.7573 14.4252 19.756 14.427 19.7548 14.4286C19.7524 14.4317 19.7499 14.436 19.7466 14.4403C19.7399 14.449 19.7311 14.4601 19.7208 14.4731C19.7001 14.4992 19.6715 14.5332 19.6364 14.5751C19.566 14.6589 19.4665 14.7734 19.3387 14.9067C19.0842 15.1723 18.712 15.5216 18.2312 15.8713C17.2736 16.5677 15.831 17.3011 14.0003 17.3011C12.1695 17.3011 10.727 16.5677 9.76938 15.8713C9.28854 15.5216 8.91634 15.1723 8.66184 14.9067C8.53409 14.7734 8.43453 14.6589 8.36415 14.5751C8.32905 14.5332 8.30044 14.4992 8.27977 14.4731C8.26946 14.4601 8.26066 14.449 8.25398 14.4403C8.25066 14.436 8.24819 14.4317 8.24578 14.4286C8.24457 14.427 8.24325 14.4252 8.24226 14.4239L8.23992 14.4215C8.24001 14.4209 8.25896 14.4064 9.19979 13.7008L8.23992 14.4204C7.8424 13.8901 7.94999 13.1385 8.48018 12.7409C9.01029 12.3435 9.76077 12.4513 10.1585 12.9812L10.1597 12.98L10.1585 12.9776H10.1573C10.1583 12.9789 10.1602 12.9801 10.162 12.9823C10.1691 12.9914 10.182 13.0091 10.2018 13.0327C10.2416 13.08 10.3064 13.1534 10.394 13.2449C10.5708 13.4293 10.8366 13.6804 11.1805 13.9305C11.873 14.4341 12.8308 14.9009 14.0003 14.9009C15.1698 14.9009 16.1276 14.4341 16.8201 13.9305C17.164 13.6804 17.4298 13.4293 17.6065 13.2449C17.6942 13.1534 17.759 13.08 17.7987 13.0327C17.8186 13.0091 17.8314 12.9914 17.8386 12.9823L17.8421 12.9776Z',
      'M10.4111 6.5C11.0739 6.5 11.6112 7.03731 11.6112 7.70012C11.6112 8.36293 11.0739 8.90025 10.4111 8.90025H10.3993C9.73653 8.90025 9.19922 8.36293 9.19922 7.70012C9.19922 7.03731 9.73653 6.5 10.3993 6.5H10.4111Z',
      'M17.6103 6.5C18.2731 6.5 18.8104 7.03731 18.8104 7.70012C18.8104 8.36293 18.2731 8.90025 17.6103 8.90025H17.5986C16.9358 8.90025 16.3984 8.36293 16.3984 7.70012C16.3984 7.03731 16.9358 6.5 17.5986 6.5H17.6103Z',
    ],
  },
  'sticky-note': {
    viewBox: '0 0 14 14',
    fillRule: 'evenodd',
    path: 'M3.709.471C4.763.353 5.867.25 7 .25s2.237.104 3.29.22h.003a3.694 3.694 0 0 1 3.247 3.256v.004c.113 1.049.21 2.145.21 3.27q-.001.595-.032 1.176l-.008.067c-.556 3.437-3.804 5.226-6.192 5.498h-.006l-.048.006a.6.6 0 0 1-.126 0q-.168.003-.338.003c-1.133 0-2.236-.103-3.29-.221h-.003A3.695 3.695 0 0 1 .46 10.272v-.004C.346 9.221.25 8.126.25 7s.097-2.222.21-3.27v-.003A3.694 3.694 0 0 1 3.707.472zm8.784 7.047h-2.37c-.854 0-1.514.656-1.628 1.442c-.22 1.52-.706 2.546-1.413 3.54H7c-1.061 0-2.108-.097-3.15-.213a2.445 2.445 0 0 1-2.148-2.153C1.592 9.1 1.5 8.057 1.5 7s.091-2.1.202-3.134A2.444 2.444 0 0 1 3.85 1.714C4.89 1.597 5.938 1.5 7 1.5s2.107.098 3.151.213a2.444 2.444 0 0 1 2.147 2.152C12.408 4.9 12.5 5.944 12.5 7q0 .259-.007.518',
  },
  'agents': {
    viewBox: '0 0 632 632',
    fillRule: 'evenodd',
    path: 'M127 239a68 68 0 1 0 136 0a68 68 0 1 0-136 0ZM368.09 239a68 68 0 1 0 136 0a68 68 0 1 0-136 0ZM384.017 338C392.689 338 400.414 345.179 398.942 354.406C392.562 394.413 358.095 425 316.5 425C274.905 425 240.438 394.413 234.058 354.406C232.586 345.179 240.311 338 248.983 338C257.937 338 264.507 345.273 266.394 353.173C271.837 375.96 292.219 392.871 316.5 392.871C340.781 392.871 361.163 375.96 366.606 353.173C368.493 345.273 375.063 338 384.017 338ZM572 316C572 208.029 572 153.622 544.053 116.073L543.388 115.19C535.764 105.176 526.824 96.2366 516.811 88.6125C479.232 60 424.821 60.0002 316 60.0002C207.179 60.0002 152.768 60 115.19 88.6125L114.254 89.3312C104.619 96.7965 95.9983 105.489 88.6125 115.19L87.9474 116.073C60.0002 153.622 60.0002 208.029 60.0002 316C60.0002 424.821 60 479.232 88.6125 516.811C96.2366 526.824 105.176 535.764 115.19 543.388C152.768 572 207.179 572 316 572C423.971 572 478.379 572 515.927 544.053L516.811 543.388C526.511 536.002 535.204 527.381 542.669 517.746L543.388 516.811C572 479.232 572 424.821 572 316ZM632 316C632 369.024 632.088 413.784 628.05 449.806C623.878 487.024 614.683 522.218 591.125 553.158C580.234 567.463 567.463 580.234 553.158 591.125C522.218 614.683 487.024 623.878 449.806 628.05C413.784 632.088 369.024 632 316 632C262.977 632 218.216 632.088 182.194 628.05C144.976 623.878 109.783 614.683 78.8419 591.125C64.5374 580.234 51.7667 567.463 40.8752 553.158C17.3168 522.218 8.12283 487.024 3.95035 449.806C-0.0879655 413.784 0.000154094 369.024 0.000154094 316C0.000154094 262.977-0.0879664 218.216 3.95035 182.194C8.12283 144.976 17.3168 109.783 40.8752 78.8419C51.7667 64.5374 64.5374 51.7667 78.8419 40.8752C109.783 17.3168 144.976 8.12283 182.194 3.95035C218.216-0.0879664 262.977 0.000154094 316 0.000154094C369.024 0.000154094 413.784-0.0879655 449.806 3.95035C487.024 8.12283 522.218 17.3168 553.158 40.8752C567.463 51.7667 580.234 64.5374 591.125 78.8419C614.683 109.783 623.878 144.976 628.05 182.194C632.088 218.216 632 262.977 632 316Z',
  },
  'codex': {
    viewBox: '0 0 24 24',
    fillRule: 'evenodd',
    path: 'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z',
  },
  'claude': {
    viewBox: '0 0 24 24',
    path: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  },
  'flow': {
    viewBox: '0 0 24 24',
    strokeWidth: '2.5',
    strokePaths: [
      'M13 19L22 12L13 5L13 19Z',
      'M2 19L11 12L2 5L2 19Z',
    ],
  },
}

/* ─── Iconoir icons (stroke-based unless fill: true) ─── */

const iconoirIcons = {
  'upload-square': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M3 20.4V3.6C3 3.26863 3.26863 3 3.6 3H20.4C20.7314 3 21 3.26863 21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4Z" stroke="currentColor" stroke-width="1.5"/><path d="M6 18L18 18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 14V6M12 6L15.5 9.5M12 6L8.5 9.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'square-dashed': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M7 4H4V7" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 11V13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 4H13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 20H13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 11V13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 4H20V7" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 20H4V17" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 20H20V17" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'key-command': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M9 6V18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 6V18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 6C9 4.34315 7.65685 3 6 3C4.34315 3 3 4.34315 3 6C3 7.65685 4.34315 9 6 9H18C19.6569 9 21 7.65685 21 6C21 4.34315 19.6569 3 18 3C16.3431 3 15 4.34315 15 6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 18C9 19.6569 7.65685 21 6 21C4.34315 21 3 19.6569 3 18C3 16.3431 4.34315 15 6 15H18C19.6569 15 21 16.3431 21 18C21 19.6569 19.6569 21 18 21C16.3431 21 15 19.6569 15 18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'plus-circle': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M8 12H12M16 12H12M12 12V8M12 12V16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'plus-circle-solid': {
    viewBox: '0 0 24 24',
    fill: true,
    content: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 1.25C6.06294 1.25 1.25 6.06294 1.25 12C1.25 17.9371 6.06294 22.75 12 22.75C17.9371 22.75 22.75 17.9371 22.75 12C22.75 6.06294 17.9371 1.25 12 1.25ZM12.75 8C12.75 7.58579 12.4142 7.25 12 7.25C11.5858 7.25 11.25 7.58579 11.25 8V11.25H8C7.58579 11.25 7.25 11.5858 7.25 12C7.25 12.4142 7.58579 12.75 8 12.75H11.25V16C11.25 16.4142 11.5858 16.75 12 16.75C12.4142 16.75 12.75 16.4142 12.75 16V12.75H16C16.4142 12.75 16.75 12.4142 16.75 12C16.75 11.5858 16.4142 11.25 16 11.25H12.75V8Z" fill="currentColor"/>',
  },
  'grid-plus': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M13.9922 17H16.9922M19.9922 17H16.9922M16.9922 17V14M16.9922 17V20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9.4V4.6C4 4.26863 4.26863 4 4.6 4H9.4C9.73137 4 10 4.26863 10 4.6V9.4C10 9.73137 9.73137 10 9.4 10H4.6C4.26863 10 4 9.73137 4 9.4Z" stroke="currentColor" stroke-width="1.5"/><path d="M4 19.4V14.6C4 14.2686 4.26863 14 4.6 14H9.4C9.73137 14 10 14.2686 10 14.6V19.4C10 19.7314 9.73137 20 9.4 20H4.6C4.26863 20 4 19.7314 4 19.4Z" stroke="currentColor" stroke-width="1.5"/><path d="M14 9.4V4.6C14 4.26863 14.2686 4 14.6 4H19.4C19.7314 4 20 4.26863 20 4.6V9.4C20 9.73137 19.7314 10 19.4 10H14.6C14.2686 10 14 9.73137 14 9.4Z" stroke="currentColor" stroke-width="1.5"/>',
  },
  'view-grid': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M14 20.4V14.6C14 14.2686 14.2686 14 14.6 14H20.4C20.7314 14 21 14.2686 21 14.6V20.4C21 20.7314 20.7314 21 20.4 21H14.6C14.2686 21 14 20.7314 14 20.4Z" stroke="currentColor" stroke-width="1.5"/><path d="M3 20.4V14.6C3 14.2686 3.26863 14 3.6 14H9.4C9.73137 14 10 14.2686 10 14.6V20.4C10 20.7314 9.73137 21 9.4 21H3.6C3.26863 21 3 20.7314 3 20.4Z" stroke="currentColor" stroke-width="1.5"/><path d="M14 9.4V3.6C14 3.26863 14.2686 3 14.6 3H20.4C20.7314 3 21 3.26863 21 3.6V9.4C21 9.73137 20.7314 10 20.4 10H14.6C14.2686 10 14 9.73137 14 9.4Z" stroke="currentColor" stroke-width="1.5"/><path d="M3 9.4V3.6C3 3.26863 3.26863 3 3.6 3H9.4C9.73137 3 10 3.26863 10 3.6V9.4C10 9.73137 9.73137 10 9.4 10H3.6C3.26863 10 3 9.73137 3 9.4Z" stroke="currentColor" stroke-width="1.5"/>',
  },
  'select-point-3d': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M12 13C12.5523 13 13 12.5523 13 12C13 11.4477 12.5523 11 12 11C11.4477 11 11 11.4477 11 12C11 12.5523 11.4477 13 12 13Z" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 7.35304L21 16.647C21 16.8649 20.8819 17.0656 20.6914 17.1715L12.2914 21.8381C12.1102 21.9388 11.8898 21.9388 11.7086 21.8381L3.30861 17.1715C3.11814 17.0656 3 16.8649 3 16.647L2.99998 7.35304C2.99998 7.13514 3.11812 6.93437 3.3086 6.82855L11.7086 2.16188C11.8898 2.06121 12.1102 2.06121 12.2914 2.16188L20.6914 6.82855C20.8818 6.93437 21 7.13514 21 7.35304Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'square-3d-three-points': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M3 21V3.6C3 3.26863 3.26863 3 3.6 3H21" stroke="currentColor"/><path d="M17 21H20.4C20.7314 21 21 20.7314 21 20.4V17" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 7V9" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12V14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 21H9" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 21H14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 4C3.55228 4 4 3.55228 4 3C4 2.44772 3.55228 2 3 2C2.44772 2 2 2.44772 2 3C2 3.55228 2.44772 4 3 4Z" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 22C3.55228 22 4 21.5523 4 21C4 20.4477 3.55228 20 3 20C2.44772 20 2 20.4477 2 21C2 21.5523 2.44772 22 3 22Z" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 4C21.5523 4 22 3.55228 22 3C22 2.44772 21.5523 2 21 2C20.4477 2 20 2.44772 20 3C20 3.55228 20.4477 4 21 4Z" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'crown': {
    viewBox: '0 0 476 342',
    strokeWidth: '0',
    fill: true,
    content: '<path d="M237.662 5.06897e-06C234.508 -0.00234318 231.407 0.811233 228.661 2.36166C225.915 3.91209 223.616 6.14664 221.989 8.84813L143.696 138.937L28.232 63.8869C25.2791 61.9709 21.8359 60.9481 18.3159 60.9415C14.796 60.9348 11.3489 61.9445 8.38878 63.8492C5.42868 65.754 3.08142 68.4728 1.62894 71.6792C0.176467 74.8855 -0.319454 78.443 0.200748 81.9244L36.7632 325.674C37.4116 330.007 39.5942 333.963 42.9136 336.821C46.2331 339.68 50.4688 341.252 54.8495 341.25H420.475C424.855 341.252 429.091 339.68 432.41 336.821C435.73 333.963 437.912 330.007 438.561 325.674L475.123 81.9244C475.643 78.443 475.148 74.8855 473.695 71.6792C472.243 68.4728 469.895 65.754 466.935 63.8492C463.975 61.9445 460.528 60.9348 457.008 60.9415C453.488 60.9481 450.045 61.9709 447.092 63.8869L331.628 138.937L253.335 8.8725C251.711 6.16648 249.414 3.92709 246.667 2.37228C243.92 0.817458 240.818 0.000185041 237.662 5.06897e-06Z" fill="currentColor"/>',
  },
  'white-flag': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M5 15L5.95039 4.54568C5.97849 4.23663 6.23761 4 6.54793 4H20.343C20.6958 4 20.9725 4.30295 20.9405 4.65432L20.0496 14.4543C20.0215 14.7634 19.7624 15 19.4521 15H5ZM5 15L4.4 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'light-bulb': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M9 18H15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 21H14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.00082 15C9.00098 13 8.50098 12.5 7.50082 11.5C6.50067 10.5 6.02422 9.48689 6.00082 8C5.95284 4.95029 8.00067 3 12.0008 3C16.001 3 18.0488 4.95029 18.0008 8C17.9774 9.48689 17.5007 10.5 16.5008 11.5C15.501 12.5 15.001 13 15.0008 15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'light-bulb-off': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M9 18H15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 21H14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.4999 11.5C17.4997 10.5 17.9765 9.48689 17.9999 8C18.0479 4.95029 16 3 11.9999 3C10.8324 3 9.83119 3.16613 8.99988 3.47724" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.99985 15C9 13 8.5 12.5 7.49985 11.5C6.4997 10.5 6.02324 9.48689 5.99985 8C5.99142 7.46458 6.0476 6.96304 6.1676 6.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3L21 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'keyframes': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M13.8476 13.317L9.50515 18.2798C8.70833 19.1905 7.29167 19.1905 6.49485 18.2798L2.15238 13.317C1.49259 12.563 1.49259 11.437 2.15238 10.683L6.49485 5.72018C7.29167 4.80952 8.70833 4.80952 9.50515 5.72017L13.8476 10.683C14.5074 11.437 14.5074 12.563 13.8476 13.317Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 19L17.8844 13.3016C18.5263 12.5526 18.5263 11.4474 17.8844 10.6984L13 5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 19L21.8844 13.3016C22.5263 12.5526 22.5263 11.4474 21.8844 10.6984L17 5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'keyframes-couple-solid': {
    viewBox: '0 0 24 24',
    fill: true,
    content: '<path fill-rule="evenodd" clip-rule="evenodd" d="M14.0658 5.18029L12.5606 6.87362L11.4395 5.87707L12.9447 4.18374C14.0386 2.95308 15.9614 2.95308 17.0554 4.18373L22.3794 10.1733C23.3056 11.2152 23.3057 12.7855 22.3795 13.8273L17.0554 19.8169C15.9614 21.0476 14.0386 21.0477 12.9447 19.8169L11.4395 18.1236L12.5606 17.1271L14.0658 18.8204C14.563 19.3798 15.437 19.3798 15.9342 18.8204L21.2583 12.8308C21.6793 12.3572 21.6793 11.6435 21.2584 11.17L15.9343 5.18029C15.437 4.6209 14.563 4.6209 14.0658 5.18029" fill="currentColor"/><path d="M6.94474 4.18374C8.03866 2.95307 9.96152 2.95308 11.0555 4.18374L16.3795 10.1733C17.3057 11.2152 17.3058 12.7855 16.3796 13.8273L11.0555 19.8169C9.96155 21.0476 8.03866 21.0477 6.94474 19.8169L1.62067 13.8273C0.694507 12.7855 0.694485 11.2152 1.62064 10.1734L6.94474 4.18374Z" fill="currentColor"/>',
  },
  'keyframe': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M20.777 13.3453L13.4799 21.3721C12.6864 22.245 11.3136 22.245 10.5201 21.3721L3.22304 13.3453C2.52955 12.5825 2.52955 11.4175 3.22304 10.6547L10.5201 2.62787C11.3136 1.755 12.6864 1.755 13.4799 2.62787L20.777 10.6547C21.4705 11.4175 21.4705 12.5825 20.777 13.3453Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'globe': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12H21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3C10.5 4.5 9.75 6.75 9.75 12C9.75 17.25 10.5 19.5 12 21C13.5 19.5 14.25 17.25 14.25 12C14.25 6.75 13.5 4.5 12 3Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'wrench': {
    viewBox: '0 0 24 24',
    strokeWidth: '1.5',
    content: '<path d="M10.0503 10.6066L2.97923 17.6777C2.19818 18.4587 2.19818 19.725 2.97923 20.5061V20.5061C3.76027 21.2871 5.0266 21.2871 5.80765 20.5061L12.8787 13.435" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.0502 10.6066C9.20638 8.45358 9.37134 5.6286 11.1109 3.88909C12.8504 2.14957 16.0606 1.76777 17.8284 2.82843L14.7877 5.8691L14.5051 8.98014L17.6161 8.69753L20.6568 5.65685C21.7175 7.42462 21.3357 10.6349 19.5961 12.3744C17.8566 14.1139 15.0316 14.2789 12.8786 13.435" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>',
  },
}

/* ─── React Component ─── */

import octicons from '@primer/octicons'
import feather from 'feather-icons'

/**
 * @param {object} props
 * @param {string} props.name - Namespaced icon name: primer/, feather/, iconoir/, or plain custom name
 * @param {number} [props.size=16]
 * @param {string} [props.label] - Accessible label (sets aria-label instead of aria-hidden)
 * @param {string} [props.color]
 * @param {number} [props.offsetX=0]
 * @param {number} [props.offsetY=0]
 * @param {number} [props.rotate=0]
 * @param {boolean} [props.flipX=false]
 * @param {boolean} [props.flipY=false]
 * @param {number} [props.strokeWeight] - Override stroke width
 * @param {number} [props.scale=1]
 * @param {string} [props.className]
 */
export default function Icon({
  name, size = 16, label, color,
  offsetX = 0, offsetY = 0, rotate = 0,
  flipX = false, flipY = false,
  strokeWeight, scale = 1, className,
}) {
  const source = name.includes('/') ? name.split('/')[0] : null
  const iconName = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name

  const ariaProps = label ? { 'aria-label': label, role: 'img' } : { 'aria-hidden': true }

  // Build wrapper style with all transform props
  const scaleX = (flipX ? -1 : 1) * scale
  const scaleY = (flipY ? -1 : 1) * scale
  const hasTransform = offsetX || offsetY || rotate || flipX || flipY || scale !== 1
  const wrapperStyle = {
    ...(color ? { color } : {}),
    display: 'inline-flex',
    ...(hasTransform ? {
      translate: (offsetX || offsetY) ? `${offsetX}px ${offsetY}px` : undefined,
      rotate: rotate ? `${rotate}deg` : undefined,
      scale: (flipX || flipY || scale !== 1) ? `${scaleX} ${scaleY}` : undefined,
    } : {}),
  }

  let svgContent = null

  // Custom icons (no source prefix)
  const custom = !source ? customIcons[iconName] : null
  if (custom) {
    if (custom.path) {
      svgContent = (
        <svg width={size} height={size} viewBox={custom.viewBox} fill="currentColor" {...ariaProps}>
          <path d={custom.path} fillRule={custom.fillRule} clipRule={custom.fillRule} />
        </svg>
      )
    } else if (custom.strokePaths) {
      svgContent = (
        <svg width={size} height={size} viewBox={custom.viewBox} fill="none" stroke="currentColor" strokeWidth={strokeWeight ?? custom.strokeWidth ?? '1.5'} strokeLinecap="round" strokeLinejoin="round" {...ariaProps}>
          {custom.strokePaths.map((d, i) => <path key={i} d={d} />)}
        </svg>
      )
    } else if (custom.strokeRect || custom.fillPaths) {
      svgContent = (
        <svg width={size} height={size} viewBox={custom.viewBox} fill="none" stroke="currentColor" strokeWidth={strokeWeight ?? '2'} {...ariaProps}>
          {custom.strokeRect && <rect {...custom.strokeRect} />}
          {custom.fillPaths?.map((d, i) => <path key={i} d={d} fill="currentColor" stroke="none" />)}
        </svg>
      )
    }
  }

  // Primer Octicons
  if (!svgContent && source === 'primer') {
    const octicon = octicons[iconName]
    if (octicon) {
      const html = octicon.toSVG({
        width: size, height: size,
        fill: 'currentColor',
        ...(label ? { 'aria-label': label } : { 'aria-hidden': 'true' }),
      })
      svgContent = <span dangerouslySetInnerHTML={{ __html: html }} />
    }
  }

  // Feather Icons
  if (!svgContent && source === 'feather') {
    const icon = feather.icons[iconName]
    if (icon) {
      const html = icon.toSvg({
        width: size, height: size,
        'stroke-width': strokeWeight ?? 2,
        ...(label ? { 'aria-label': label } : { 'aria-hidden': 'true' }),
      })
      svgContent = <span dangerouslySetInnerHTML={{ __html: html }} />
    }
  }

  // Iconoir icons
  if (!svgContent && source === 'iconoir') {
    const iconoir = iconoirIcons[iconName]
    if (iconoir) {
      const sw = strokeWeight ?? iconoir.strokeWidth
      svgContent = (
        <svg
          width={size} height={size} viewBox={iconoir.viewBox}
          fill={iconoir.fill ? 'currentColor' : 'none'}
          strokeWidth={iconoir.fill ? undefined : sw}
          {...ariaProps}
          dangerouslySetInnerHTML={{ __html: iconoir.content }}
        />
      )
    }
  }

  if (!svgContent) return null

  return <span className={className} style={wrapperStyle}>{svgContent}</span>
}
