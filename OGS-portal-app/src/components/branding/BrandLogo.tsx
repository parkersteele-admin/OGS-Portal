import './BrandLogo.css'

type BrandLogoProps = {
  className?: string
  alt?: string
}

export function BrandLogo({ className = '', alt = 'Ohio Gas Supply' }: BrandLogoProps) {
  const classes = className ? `brand-logo ${className}` : 'brand-logo'

  return <img className={classes} src="/logo.svg" alt={alt} />
}
