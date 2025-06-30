import express from 'express'
import { 
  canManageManagers,
  canRemoveManager,
  addManager, 
  removeManager, 
  updateManagerLevel, 
  getManagedUsers 
} from '../../../helpers/managers.js'

export default function ({ db }) {
  const router = express.Router()

  // Get all users managed by the current user
  router.get('/managed', async (req, res) => {
    try {
      const managedUsers = await getManagedUsers(req.user._id)
      res.json({ 
        success: true, 
        users: managedUsers.map(user => ({
          _id: user._id,
          displayName: user.displayName,
          isManaged: user.isManaged,
          managers: user.managers
        }))
      })
    } catch (error) {
      res.json({ success: false, error: error.message })
    }
  })

  // Add a manager to a user
  router.post('/:userId/add/:managerId/:level', async (req, res) => {
    try {
      const targetUser = await db.users.get(req.params.userId)
      
      // Validate level
      if (!['full', 'collaborator'].includes(req.params.level)) {
        return res.json({ success: false, error: 'Invalid manager level' })
      }

      // Check permissions
      if (!canManageManagers(req.user, req.params.userId, targetUser, req.params.level)) {
        return res.json({ success: false, error: 'Insufficient permissions' })
      }

      // Validate manager exists
      await db.users.get(req.params.managerId)

      await addManager(req.params.userId, req.params.managerId, req.params.level, req.user._id)
      
      res.json({ success: true })
    } catch (error) {
      res.json({ success: false, error: error.message })
    }
  })

  // Remove a manager from a user
  router.post('/:userId/remove/:managerId', async (req, res) => {
    try {
      const targetUser = await db.users.get(req.params.userId)
      
      // Check permissions
      if (!canRemoveManager(req.user, req.params.userId, targetUser, req.params.managerId)) {
        return res.json({ success: false, error: 'Insufficient permissions' })
      }

      await removeManager(req.params.userId, req.params.managerId)
      
      res.json({ success: true })
    } catch (error) {
      res.json({ success: false, error: error.message })
    }
  })

  // Update a manager's level
  router.post('/:userId/update/:managerId/:newLevel', async (req, res) => {
    try {
      const targetUser = await db.users.get(req.params.userId)
      
      // Check permissions
      if (!canManageManagers(req.user, req.params.userId, targetUser)) {
        return res.json({ success: false, error: 'Insufficient permissions' })
      }

      // Validate level
      if (!['full', 'collaborator'].includes(req.params.newLevel)) {
        return res.json({ success: false, error: 'Invalid manager level' })
      }

      await updateManagerLevel(req.params.userId, req.params.managerId, req.params.newLevel)
      
      res.json({ success: true })
    } catch (error) {
      res.json({ success: false, error: error.message })
    }
  })

  return router
} 