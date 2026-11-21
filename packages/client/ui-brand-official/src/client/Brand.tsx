import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * AuditDesk sidebar mark: a simple monogram kept inline so the product owns its identity.
 * @param props - Host-supplied mark presentation.
 * @returns the branded mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  const side = typeof size === 'number' && size > 0 ? size : 28
  return (
    <svg width={side} height={side} viewBox="0 0 32 32" role="img" aria-label="AuditDesk">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--dsw-alias-label-primary, #14213d)" />
      <path d="M16 7 L25 25 H20.8 L19.2 21.4 H12.8 L11.2 25 H7 Z M13.9 18 H18.1 L16 13.2 Z"
        fill="var(--dsw-alias-label-primary-inverted, #f6efdc)" />
    </svg>
  )
}

/**
 * Render the product name without an independently slotted mark.
 * @returns the wordmark.
 */
export function OfficialBrandName() {
  return (
    <span style={{ fontWeight: 600, letterSpacing: '0.02em', fontSize: '0.95em' }}>AuditDesk</span>
  )
}
