import createDOMPurify from 'dompurify'
import express from 'express'
import { JSDOM } from 'jsdom'
import marked from 'marked'

import publicRoute from '../../middlewares/publicRoute.js'
import verifyAuth from '../../middlewares/verifyAuth.js'
import { canMoveItems } from '../../helpers/managers.js'

const window = new JSDOM('').window
const DOMPurify = createDOMPurify(window)

const totals = wishlist => {
  let unpledged = 0
  let pledged = 0
  wishlist.forEach(wishItem => {
    if (wishItem.pledgedBy) pledged += 1
    else unpledged += 1
  })
  return { unpledged, pledged }
}

const groupIntersects = (groups, other) => {
	if (groups?.length > 0 && other?.length > 0)
		return groups.some(g => other.includes(g))

	return false
}

export default function (db) {
  const router = express.Router()

  const wishlistManager = _CC.wishlistManager

  router.get('/', publicRoute(), async (req, res) => {
    const docs = await db.users.allDocs({ include_docs: true })
    if (global._CC.config.wishlist.singleList) {
      for (const row of docs.rows) {
        if (row.doc.admin) return res.redirect(`/wishlist/${row.doc._id}`)
      }
    }

		var groupFilteredDocs = docs.rows.filter(d => d.id == req.user.id || groupIntersects(d.doc.groups, req.user.groups))

    res.render('wishlists', { title: _CC.lang('WISHLISTS_TITLE'), users: groupFilteredDocs, totals })
  })

  async function redirectIfSingleUserMode (req, res, next) {
    const dbUser = await db.users.get(req.params.user)
    if (_CC.config.wishlist.singleList) {
      if (!dbUser.admin) {
        const docs = await db.users.allDocs({ include_docs: true })
        for (const row of docs.rows) {
          if (row.doc.admin) return res.redirect(`/wishlist/${row.doc._id}`)
        }
      }
    }
    next()
  }

  router.get('/:user', publicRoute(), redirectIfSingleUserMode, async (req, res) => {
    try {
      const wishlist = await wishlistManager.get(req.params.user)
      await wishlist.fetch()
      const items = await wishlist.itemsVisibleToUser(req.user._id)

      const isOwnWishlist = req.user._id === wishlist.username

			if (!isOwnWishlist && !groupIntersects(req.user.groups, wishlist.doc.groups)) {
				req.flash('error', `Wishlist not found`)
				return res.redirect('/')
			}

      const compiledNotes = {}
      if (_CC.config.wishlist.note.markdown) {
        for (const item of items) {
          compiledNotes[item.id] = DOMPurify.sanitize(marked(item.note))
        }
      }
			
			const userDocs = await db.users.allDocs({ include_docs: true })
			var itemsWithAddedByDisplayName = items
				.map(i => ({ 
					...i,
					addedByDisplayName: userDocs.rows.find(d => d.id === i.addedBy )?.doc.displayName
				}))

      // Check if current user can manage this wishlist
      const canManage = canMoveItems(req.user, req.params.user, wishlist.doc)

      res.render('wishlist', {
        title: _CC.lang('WISHLIST_TITLE', wishlist.title),
        name: wishlist.title,
        items: itemsWithAddedByDisplayName,
        compiledNotes,
        sharedInfo: wishlist.doc?.info ?? {},
        canManageWishlist: canManage
      })
    } catch (error) {
      req.flash('error', error)
      return res.redirect('/wishlist')
    }
  })

  router.post('/:user', verifyAuth(), async (req, res) => {
    try {
      const wishlist = await wishlistManager.get(req.params.user)

      const isOwnWishlist = req.user._id === wishlist.username
			if (!isOwnWishlist && !groupIntersects(req.user.groups, wishlist.doc.groups)) {
				req.flash('error', `Wishlist not found`)
				return res.redirect('/')
			}

      const { nonFatalErrors } = await wishlist.add({
        itemUrlOrName: req.body.itemUrlOrName,
        suggest: req.body.suggest,
        note: req.body.note,
        addedBy: req.user._id
      })

      for (const error of nonFatalErrors) {
        req.flash('error', error)
      }

      req.flash('success',
        req.user._id === req.params.user
          ? _CC.lang('WISHLIST_ADDED_ITEM_TO_OWN_WISHLIST')
          : _CC.lang('WISHLIST_PLEDGED_ITEM_FOR_USER', req.params.user)
      )
    } catch (error) {
      req.flash('error', `${error}`)
    }

    res.redirect(`/wishlist/${req.params.user}`)
  })

  router.post('/:user/pledge/:itemId', verifyAuth(), async (req, res) => {
    try {
      const wishlist = await wishlistManager.get(req.params.user)
      const item = await wishlist.get(req.params.itemId)

      const isOwnWishlist = req.user._id === wishlist.username
			if (!isOwnWishlist && !groupIntersects(req.user.groups, wishlist.doc.groups)) {
				req.flash('error', `Wishlist not found`)
				return res.redirect('/')
			}

      if (item.pledgedBy !== undefined) {
        throw new Error(_CC.lang('WISHLIST_PLEDGE_DUPLICATE'))
      }

      await wishlist.pledge(item.id, req.user._id)
    } catch (error) {
      req.flash('error', `${error}`)
    }

    res.redirect(`/wishlist/${req.params.user}`)
  })

  router.post('/:user/unpledge/:itemId', verifyAuth(), async (req, res) => {
    try {
      const wishlist = await wishlistManager.get(req.params.user)
      const item = await wishlist.get(req.params.itemId)

      const isOwnWishlist = req.user._id === wishlist.username
			if (!isOwnWishlist && !groupIntersects(req.user.groups, wishlist.doc.groups)) {
				req.flash('error', `Wishlist not found`)
				return res.redirect('/')
			}

      const pledgedByUser = item.pledgedBy === req.user._id
      if (!pledgedByUser) {
        throw new Error(_CC.lang('WISHLIST_UNPLEDGE_GUARD'))
      }

      await wishlist.unpledge(item.id)

      req.flash('success', _CC.lang('WISHLIST_UNPLEDGE_SUCCESS'))
    } catch (error) {
      req.flash('error', `${error}`)
    }

    res.redirect(`/wishlist/${req.params.user}`)
  })

  router.post('/:user/remove/:itemId', verifyAuth(), async (req, res) => {
    try {
      const wishlist = await wishlistManager.get(req.params.user)
      const item = await wishlist.get(req.params.itemId)

      const isOwnWishlist = req.user._id === wishlist.username
			if (!isOwnWishlist && !groupIntersects(req.user.groups, wishlist.doc.groups)) {
				req.flash('error', `Wishlist not found`)
				return res.redirect('/')
			}

      const addedByUser = item.addedBy === req.user._id
      if (!isOwnWishlist && !addedByUser) {
        throw new Error(_CC.lang('WISHLIST_REMOVE_GUARD'))
      }

      await wishlist.remove(item.id)

      req.flash('success', _CC.lang('WISHLIST_REMOVE_SUCCESS'))
    } catch (error) {
      req.flash('error', `${error}`)
    }

    res.redirect(`/wishlist/${req.params.user}`)
  })

  router.post('/:user/move/:direction/:itemId', verifyAuth(), async (req, res) => {
    try {
      // Get the target user document to check manager permissions
      const targetUser = await db.users.get(req.params.user)
      
      // Check if user can move items (owner or manager)
      if (!canMoveItems(req.user, req.params.user, targetUser)) {
        throw new Error(_CC.lang('WISHLIST_MOVE_GUARD'))
      }

      const wishlist = await wishlistManager.get(req.params.user)

      if (req.params.direction === 'top') {
        await wishlist.moveTop(req.params.itemId)
      } else if (req.params.direction === 'bottom') {
        await wishlist.moveBottom(req.params.itemId)
      } else if (req.params.direction === 'up') {
        await wishlist.move(req.params.itemId, -1)
      } else if (req.params.direction === 'down') {
        await wishlist.move(req.params.itemId, 1)
      } else {
        throw new Error(_CC.lang('WISHLIST_MOVE_UNKNOWN_DIRECTION'))
      }

      req.flash('success', _CC.lang('WISHLIST_MOVE_SUCCESS'))
    } catch (error) {
      req.flash('error', `${error}`)
    }

    res.redirect(`/wishlist/${req.params.user}`)
  })

  router.get('/:user/note/:id', verifyAuth(), async (req, res) => {
    try {
      const wishlist = await wishlistManager.get(req.params.user)

      const isOwnWishlist = req.user._id === wishlist.username
			if (!isOwnWishlist && !groupIntersects(req.user.groups, wishlist.doc.groups)) {
				req.flash('error', `Wishlist not found`)
				return res.redirect('/')
			}

      const item = await wishlist.get(req.params.id)
      res.render('note', { item, wishlistTitle: wishlist.title })
    } catch (error) {
      req.flash('error', `${error}`)
      res.redirect(`/wishlist/${req.params.user}`)
    }
  })

  router.post('/:user/note/:id', verifyAuth(), async (req, res) => {
    try {
      const wishlist = await wishlistManager.get(req.params.user)
      const item = await wishlist.get(req.params.id)

      const isOwnWishlist = req.user._id === wishlist.username
			if (!isOwnWishlist && !groupIntersects(req.user.groups, wishlist.doc.groups)) {
				req.flash('error', `Wishlist not found`)
				return res.redirect('/')
			}

      const addedByUser = req.user._id === item.addedBy
      if (!isOwnWishlist && !addedByUser) {
        throw new Error(_CC.lang('NOTE_GUARD'))
      }

      await wishlist.setItemData(req.params.id, req.body)

      req.flash('success', _CC.lang('NOTE_SUCCESS'))
      res.redirect(`/wishlist/${req.params.user}`)
    } catch (error) {
      req.flash('error', `${error}`)
      res.redirect(`/wishlist/${req.params.user}/note/${req.params.id}`)
    }
  })

  router.post('/:user/refresh/:id', verifyAuth(), async (req, res) => {
    try {
      const wishlist = await wishlistManager.get(req.params.user)
      const item = await wishlist.get(req.params.id)

      const isOwnWishlist = req.user._id === wishlist.username
			if (!isOwnWishlist && !groupIntersects(req.user.groups, wishlist.doc.groups)) {
				req.flash('error', `Wishlist not found`)
				return res.redirect('/')
			}

      const addedByUser = req.user._id === item.addedBy
      if (!isOwnWishlist && !addedByUser) {
        throw new Error(_CC.lang('WISHLIST_REFRESH_GUARD'))
      }

      await wishlist.refreshItemData(item.id)

      req.flash('success', _CC.lang('WISHLIST_REFRESH_SUCCESS'))
    } catch (error) {
      req.flash('error', `${error}`)
    }

    res.redirect(`/wishlist/${req.params.user}/note/${req.params.id}`)
  })

  return router
}
