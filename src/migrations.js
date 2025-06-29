export async function ensureManagersField() {
  console.log('Checking for managers field migration...');
  
  try {
    const users = await _CC.usersDb.allDocs({include_docs: true, limit: 1});
    if (users.rows.length > 0 && !users.rows[0].doc.hasOwnProperty('managers')) {
      console.log('Adding managers field to all users...');
      
      const allUsers = await _CC.usersDb.allDocs({include_docs: true});
      const updates = allUsers.rows.map(row => ({
        ...row.doc,
        managers: [],
        isManaged: false
      }));
      
      await _CC.usersDb.bulkDocs(updates);
      console.log(`Updated ${updates.length} users with managers field`);
    } else {
      console.log('Managers field migration already completed');
    }
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  }
}

// Convert a specific user to managed status with initial managers
export async function convertUserToManaged(userId, initialManagers = [], convertedBy = 'system') {
  try {
    console.log(`Converting user ${userId} to managed status...`);
    
    const user = await _CC.usersDb.get(userId);
    
    // Add managers with proper structure
    const managersWithMeta = initialManagers.map(manager => ({
      userId: manager.userId,
      level: manager.level || 'full', // default to full for conversions
      addedBy: convertedBy,
      addedAt: new Date().toISOString()
    }));
    
    user.managers = managersWithMeta;
    user.isManaged = true;
    
    await _CC.usersDb.put(user);
    console.log(`Successfully converted ${userId} to managed user with ${managersWithMeta.length} managers`);
    
    return user;
  } catch (error) {
    console.error(`Error converting user ${userId} to managed:`, error);
    throw error;
  }
} 