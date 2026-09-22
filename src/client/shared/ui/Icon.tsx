type IconProps = { name: string; size?: 'md' | 'lg' | 'xl'; className?: string };

const SIZE_CLASS: Record<NonNullable<IconProps['size']>, string> = { md: '', lg: 'ic--lg', xl: 'ic--xl' };

/** References a <symbol> from IconSprite. IconSprite must be mounted once, higher in the tree. */
export function Icon({ name, size = 'md', className }: IconProps) {
  const cls = ['ic', SIZE_CLASS[size], className].filter(Boolean).join(' ');
  return (
    <svg className={cls} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
