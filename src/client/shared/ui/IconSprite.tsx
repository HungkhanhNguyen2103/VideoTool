/**
 * SVG <symbol> definitions reused across pages, copied verbatim from the prototypes'
 * inline sprite (docs/prototypes/khoi-tao-du-an/index.html). Mounted once by App.tsx;
 * <Icon name="..."> references a symbol by id.
 */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <symbol id="i-film" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
      </symbol>
      <symbol id="i-chart" viewBox="0 0 24 24">
        <path d="M4 20h17M6 17v-5h3v5M11 17V7h3v10M16 17V3h3v14" />
      </symbol>
      <symbol id="i-lock" viewBox="0 0 24 24">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </symbol>
      <symbol id="i-sparkles" viewBox="0 0 24 24">
        <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
      </symbol>
      <symbol id="i-doc" viewBox="0 0 24 24">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M9 13h6M9 17h6" />
      </symbol>
      <symbol id="i-video" viewBox="0 0 24 24">
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="M16 10l5-3v10l-5-3z" />
      </symbol>
      <symbol id="i-tag" viewBox="0 0 24 24">
        <path d="M3 12V4h8l10 10-8 8z" />
        <circle cx="7.5" cy="8.5" r="1.2" />
      </symbol>
      <symbol id="i-arrow-right" viewBox="0 0 24 24">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </symbol>
      <symbol id="i-pin" viewBox="0 0 24 24">
        <path d="M12 21v-7M8 3h8l-1 6 3 3H6l3-3z" />
      </symbol>
      <symbol id="i-list" viewBox="0 0 24 24">
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </symbol>
      <symbol id="i-folder" viewBox="0 0 24 24">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </symbol>
      <symbol id="i-upload" viewBox="0 0 24 24">
        <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
      </symbol>
      <symbol id="i-copy" viewBox="0 0 24 24">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h9" />
      </symbol>
      <symbol id="i-trash" viewBox="0 0 24 24">
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6L6 18" />
      </symbol>
      <symbol id="i-alert" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24">
        <path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4" />
      </symbol>
      <symbol id="i-edit" viewBox="0 0 24 24">
        <path d="M4 20h4L19 9l-4-4L4 16z" />
      </symbol>
      <symbol id="i-flag" viewBox="0 0 24 24">
        <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
      </symbol>
      <symbol id="i-save" viewBox="0 0 24 24">
        <path d="M5 3h11l3 3v15H5z" />
        <path d="M8 3v5h7V3M8 21v-7h8v7" />
      </symbol>
      <symbol id="i-chevron" viewBox="0 0 24 24">
        <path d="M6 9l6 6 6-6" />
      </symbol>
      <symbol id="i-arrow-left" viewBox="0 0 24 24">
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </symbol>
      <symbol id="i-history" viewBox="0 0 24 24">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="M5 12l5 5L20 7" />
      </symbol>
    </svg>
  );
}
