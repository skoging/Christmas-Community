// Helper functions for wishlist manager permissions

/**
 * Check if a user can manage another user's wishlist
 * @param {object} managerUser - The user who wants to manage
 * @param {string} targetUserId - The ID of the user whose wishlist is being managed
 * @param {object} targetUserDoc - The target user document
 * @returns {object} { canManage: boolean, level: 'full'|'collaborator'|null }
 */
export function canManageWishlist(managerUser, targetUserId, targetUserDoc) {
  // Owner can always manage their own wishlist
  if (managerUser._id === targetUserId) {
    return { canManage: true, level: 'owner' };
  }

  // Check if user is a manager of the target user
  const managerEntry = targetUserDoc.managers?.find(m => m.userId === managerUser._id);
  if (managerEntry) {
    return { canManage: true, level: managerEntry.level };
  }

  return { canManage: false, level: null };
}

/**
 * Check if a user has permission to move items in a wishlist
 * @param {object} managerUser - The user who wants to move items
 * @param {string} targetUserId - The ID of the user whose wishlist is being managed
 * @param {object} targetUserDoc - The target user document
 * @returns {boolean}
 */
export function canMoveItems(managerUser, targetUserId, targetUserDoc) {
  const { canManage } = canManageWishlist(managerUser, targetUserId, targetUserDoc);
  return canManage;
}

/**
 * Check if a user has permission to edit another user's profile
 * @param {object} managerUser - The user who wants to edit
 * @param {string} targetUserId - The ID of the user whose profile is being edited
 * @param {object} targetUserDoc - The target user document
 * @returns {boolean}
 */
export function canEditProfile(managerUser, targetUserId, targetUserDoc) {
  const { canManage, level } = canManageWishlist(managerUser, targetUserId, targetUserDoc);
  return canManage && level === 'full';
}

/**
 * Check if a user can add/remove managers for another user
 * @param {object} managerUser - The user who wants to manage managers
 * @param {string} targetUserId - The ID of the user whose managers are being modified
 * @param {object} targetUserDoc - The target user document
 * @returns {boolean}
 */
export function canManageManagers(managerUser, targetUserId, targetUserDoc) {
  // Only admins and full managers can manage managers
  if (managerUser.admin) return true;
  
  const { canManage, level } = canManageWishlist(managerUser, targetUserId, targetUserDoc);
  return canManage && level === 'full';
}

/**
 * Add a manager to a user
 * @param {string} targetUserId - The user to add a manager to
 * @param {string} managerId - The user to add as a manager
 * @param {string} level - The manager level ('full' or 'collaborator')
 * @param {string} addedBy - Who is adding this manager
 * @returns {Promise<object>} Updated user document
 */
export async function addManager(targetUserId, managerId, level, addedBy) {
  const user = await _CC.usersDb.get(targetUserId);
  
  // Initialize managers array if it doesn't exist
  if (!user.managers) {
    user.managers = [];
  }

  // Check if manager already exists
  const existingIndex = user.managers.findIndex(m => m.userId === managerId);
  if (existingIndex !== -1) {
    throw new Error('User is already a manager');
  }

  // Add new manager
  user.managers.push({
    userId: managerId,
    level: level,
    addedBy: addedBy,
    addedAt: new Date().toISOString()
  });

  // Set isManaged to true if not already
  user.isManaged = true;

  await _CC.usersDb.put(user);
  return user;
}

/**
 * Remove a manager from a user
 * @param {string} targetUserId - The user to remove a manager from
 * @param {string} managerId - The manager to remove
 * @returns {Promise<object>} Updated user document
 */
export async function removeManager(targetUserId, managerId) {
  const user = await _CC.usersDb.get(targetUserId);
  
  if (!user.managers) {
    throw new Error('User has no managers');
  }

  // Remove manager
  user.managers = user.managers.filter(m => m.userId !== managerId);

  // Set isManaged to false if no managers left
  if (user.managers.length === 0) {
    user.isManaged = false;
  }

  await _CC.usersDb.put(user);
  return user;
}

/**
 * Get all users that a manager can manage
 * @param {string} managerId - The manager's user ID
 * @returns {Promise<Array>} Array of users that can be managed
 */
export async function getManagedUsers(managerId) {
  const allUsers = await _CC.usersDb.allDocs({ include_docs: true });
  return allUsers.rows
    .map(row => row.doc)
    .filter(user => user.managers?.some(m => m.userId === managerId));
}

/**
 * Update a manager's level
 * @param {string} targetUserId - The user whose manager level to update
 * @param {string} managerId - The manager whose level to update
 * @param {string} newLevel - The new level ('full' or 'collaborator')
 * @returns {Promise<object>} Updated user document
 */
export async function updateManagerLevel(targetUserId, managerId, newLevel) {
  const user = await _CC.usersDb.get(targetUserId);
  
  if (!user.managers) {
    throw new Error('User has no managers');
  }

  const managerIndex = user.managers.findIndex(m => m.userId === managerId);
  if (managerIndex === -1) {
    throw new Error('Manager not found');
  }

  user.managers[managerIndex].level = newLevel;
  user.managers[managerIndex].updatedAt = new Date().toISOString();

  await _CC.usersDb.put(user);
  return user;
} 