const DEVICE_KEY = 'fc_device_id'

export function getDeviceId() {
  let id = null
  try {
    id = localStorage.getItem(DEVICE_KEY)
  } catch {
    // Ignore storage restrictions
  }

  if (!id) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      id = crypto.randomUUID()
    } else {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    }
    try {
      localStorage.setItem(DEVICE_KEY, id)
    } catch {
      // Ignore storage restrictions
    }
  }

  return id
}
