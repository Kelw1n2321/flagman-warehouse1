/** Знак «Свежачок!»: поварской колпак, галочка свежести и лист. Тёмные части берут цвет темы, лист всегда зелёный. */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      <path
        className="logo-mark__hat"
        d="M24 27c-4.5-.4-7-3.6-6.4-7.4.6-3.7 4.2-6.1 8-5.2 1.6-4.4 5.7-6.9 10.2-6.3 4.6.6 7.8 4 8.1 8.4 3.9-.2 7 2.7 7.1 6.4.1 3.4-2.4 6.1-5.7 6.6"
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path className="logo-mark__ink" d="M21 42.5 31.5 53 54 30.5v8L31.5 61 21 50.5Z" />
      <path className="logo-mark__leaf" d="M4 26.5c13.5-2.6 24 4.6 25.4 20.5C15.3 48.6 5.2 41 4 26.5Z" />
      <path className="logo-mark__vein" d="M10 31.5c6 3.3 10.5 8 14 13.6" fill="none" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Название с зелёным восклицательным знаком. */
export function Wordmark() {
  return (
    <span className="wordmark">
      Свежачок<span className="wordmark__bang">!</span>
    </span>
  );
}
