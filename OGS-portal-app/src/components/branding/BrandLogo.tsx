import './BrandLogo.css'

const LOGO_ASSET_VERSION = '20260519'

type BrandLogoProps = {
  className?: string
  alt?: string
  variant?: 'dark' | 'white'
}

export function BrandLogo({
  className = '',
  alt = 'Ohio Gas Supply',
  variant = 'dark',
}: BrandLogoProps) {
  const classes = className ? `brand-logo ${className}` : 'brand-logo'
  const src = variant === 'white'
    ? `/logo-white.png?v=${LOGO_ASSET_VERSION}`
    : `/logo.svg?v=${LOGO_ASSET_VERSION}`

  return <img className={classes} src={src} alt={alt} />
}
