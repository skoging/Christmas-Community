import express from 'express'
import { canMoveItems } from '../../../helpers/managers.js'

export default function ({ db }) {
  const router = express.Router()

  router.get('/', (req, res) => {
    res.send({
      route: 'wishlist'
    })
  })

  router.post('/:user/:itemId/move/:direction', async (req, res) => {
    try {
      // Get the target user document to check manager permissions
      const targetUser = await db.users.get(req.params.user)
      
      // Check if user can move items (owner or manager)
      if (!canMoveItems(req.user, req.params.user, targetUser)) {
        throw new Error(_CC.lang('WISHLIST_MOVE_GUARD'))
      }

      const wishlist = await _CC.wishlistManager.get(req.params.user)
      if (req.params.direction === 'top') {
        await wishlist.moveTop(req.params.itemId)
      } else if (req.params.direction === 'up') {
        await wishlist.move(req.params.itemId, -1)
      } else if (req.params.direction === 'down') {
        await wishlist.move(req.params.itemId, 1)
      } else {
        throw new Error(_CC.lang('WISHLIST_MOVE_UNKNOWN_DIRECTION'))
      }
    } catch (error) {
      return res.send({ error: error.message })
    }

    res.send({ error: false })
  })

  return router
}
