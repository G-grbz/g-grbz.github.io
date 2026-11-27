// modules/player/auth.js publicUser (the rest of the account store is not needed).
export function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    disabled: Boolean(row.disabled),
    canDownload: row.role === 'admin' || Boolean(row.can_download),
    allLibraries: row.role === 'admin' || Boolean(row.all_libraries),
    createdAt: row.created_at
  }
}
