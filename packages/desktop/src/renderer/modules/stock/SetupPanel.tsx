import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Action } from '../../actions/Action.js'
import { Icon } from '../../shell/Icon.js'
import { EmptyState } from '../../components/EmptyState.js'
import { useMessages } from '../../components/Messages.js'
import { Modal } from '../../components/Modal.js'
import type { CategoryNodeDto, LocationDto } from '../../../shared/ipc.js'

/**
 * The shop's own vocabulary: the two-level category tree and the locations.
 *
 * Nothing here is hardcoded — rings, bangles, showcase 1, the safe — because
 * every shop names these differently. Nothing here deletes, either: a category
 * or location that has appeared on a piece stays readable forever, so the
 * controls offer rename and deactivate and no third thing.
 */

interface Renaming {
  readonly kind: 'category' | 'location'
  readonly id: string
  readonly current: string
}

export function SetupPanel() {
  const [tree, setTree] = useState<readonly CategoryNodeDto[]>([])
  const [locations, setLocations] = useState<readonly LocationDto[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [newTop, setNewTop] = useState('')
  const [newChild, setNewChild] = useState<{ parentId: string; name: string } | null>(null)
  const [newLocation, setNewLocation] = useState('')
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [renameText, setRenameText] = useState('')
  const { push } = useMessages()

  const refresh = useCallback(async () => {
    const [nextTree, nextLocations] = await Promise.all([
      window.api.inventoryCategoryTree(showInactive),
      window.api.inventoryLocations(showInactive),
    ])
    setTree(nextTree)
    setLocations(nextLocations)
  }, [showInactive])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Every write funnels through here: show the refusal, or refresh the lists. */
  const apply = useCallback(
    async (work: Promise<{ ok: true } | { ok: false; message: string }>) => {
      const result = await work
      if (!result.ok) {
        push('bad', result.message)
        return false
      }
      await refresh()
      return true
    },
    [refresh, push],
  )

  const addTop = useCallback(async () => {
    if (!newTop.trim()) return
    if (await apply(window.api.inventoryCategoryCreate(null, newTop))) setNewTop('')
  }, [newTop, apply])

  const addChild = useCallback(async () => {
    if (!newChild || !newChild.name.trim()) return
    if (await apply(window.api.inventoryCategoryCreate(newChild.parentId, newChild.name))) {
      setNewChild(null)
    }
  }, [newChild, apply])

  const addLocation = useCallback(async () => {
    if (!newLocation.trim()) return
    if (await apply(window.api.inventoryLocationCreate(newLocation))) setNewLocation('')
  }, [newLocation, apply])

  const saveRename = useCallback(async () => {
    if (!renaming) return
    const call =
      renaming.kind === 'category'
        ? window.api.inventoryCategoryRename(renaming.id, renameText)
        : window.api.inventoryLocationRename(renaming.id, renameText)
    if (await apply(call)) setRenaming(null)
  }, [renaming, renameText, apply])

  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'setup.rename.save': () => void saveRename(),
      'setup.rename.cancel': () => setRenaming(null),
    }
    const listener = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      handlers[id]?.()
    }
    window.addEventListener('jewellery:action', listener)
    return () => window.removeEventListener('jewellery:action', listener)
  }, [saveRename])

  const rowActions = (
    kind: Renaming['kind'],
    id: string,
    name: string,
    isActive: boolean,
  ): ReactNode => (
    <span className="bucket-action">
      <Action
        id={kind === 'category' ? 'category.rename' : 'location.rename'}
        variant="icon"
        ariaLabel={`Rename ${name}`}
        onActivate={() => {
          setRenaming({ kind, id, current: name })
          setRenameText(name)
        }}
      >
        <Icon name="eye" size={16} />
      </Action>
      <Action
        id={kind === 'category' ? 'category.active.toggle' : 'location.active.toggle'}
        variant="icon"
        {...(isActive ? { className: 'is-danger' } : {})}
        ariaLabel={`${isActive ? 'Deactivate' : 'Activate'} ${name}`}
        onActivate={() =>
          void apply(
            kind === 'category'
              ? window.api.inventoryCategorySetActive(id, !isActive)
              : window.api.inventoryLocationSetActive(id, !isActive),
          )
        }
      >
        <Icon name={isActive ? 'cross' : 'plus'} size={16} />
      </Action>
    </span>
  )

  return (
    <div className="panel__body">
      <div className="field-row">
        <p className="callout">
          Categories and locations are the shop&apos;s own words — nothing here comes
          pre-named. Both rename and deactivate; neither ever deletes, so an old piece
          keeps its labels readable.
        </p>
        <span className="toolbar__end">
          <Action
            id="item.inactive.show"
            variant="toolbar"
            active={showInactive}
            onActivate={() => setShowInactive((current) => !current)}
          >
            {showInactive ? 'Hiding nothing' : 'Show deactivated'}
          </Action>
        </span>
      </div>

      <div className="field-row">
        {/* ── the category tree ─────────────────────────────────────────── */}
        <div className="panel setup-column">
          <div className="panel__title">CATEGORIES</div>
          <div className="panel__body">
            <div className="field-row field-row--flush">
              <input
                className="input"
                value={newTop}
                onChange={(e) => setNewTop(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addTop()
                }}
                placeholder="New category, e.g. Rings"
                aria-label="New category name"
              />
              <Action id="category.add" variant="outline" onActivate={() => void addTop()}>
                <Icon name="plus" size={16} /> Add
              </Action>
            </div>

            {tree.length === 0 ? (
              <EmptyState
                title="No categories yet"
                line="Rings, bangles, chains, sets — whatever this shop calls them. Two levels, no more."
              />
            ) : (
              tree.map((node) => (
                <div key={node.id} className="setup-tree__group">
                  <div className="summary-line">
                    <span>
                      {node.name}
                      {node.isActive ? null : <span className="badge">off</span>}
                    </span>
                    <span className="summary-line__value">
                      <span className="bucket-action">
                        <Action
                          id="category.add"
                          variant="icon"
                          ariaLabel={`Add a sub-category under ${node.name}`}
                          onActivate={() => setNewChild({ parentId: node.id, name: '' })}
                        >
                          <Icon name="plus" size={16} />
                        </Action>
                        {rowActions('category', node.id, node.name, node.isActive)}
                      </span>
                    </span>
                  </div>
                  {node.children.map((child) => (
                    <div key={child.id} className="summary-line setup-tree__child">
                      <span>
                        › {child.name}
                        {child.isActive ? null : <span className="badge">off</span>}
                      </span>
                      <span className="summary-line__value">
                        {rowActions('category', child.id, child.name, child.isActive)}
                      </span>
                    </div>
                  ))}
                  {newChild?.parentId === node.id ? (
                    <div className="field-row field-row--flush setup-tree__child">
                      <input
                        className="input"
                        value={newChild.name}
                        onChange={(e) =>
                          setNewChild({ parentId: node.id, name: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void addChild()
                          if (e.key === 'Escape') setNewChild(null)
                        }}
                        placeholder={`New sub-category under ${node.name}`}
                        aria-label={`New sub-category under ${node.name}`}
                        autoFocus
                      />
                      <Action
                        id="category.add"
                        variant="outline"
                        onActivate={() => void addChild()}
                      >
                        Add
                      </Action>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── locations ─────────────────────────────────────────────────── */}
        <div className="panel setup-column">
          <div className="panel__title">LOCATIONS</div>
          <div className="panel__body">
            <div className="field-row field-row--flush">
              <input
                className="input"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addLocation()
                }}
                placeholder="New location, e.g. Showcase 1"
                aria-label="New location name"
              />
              <Action id="location.add" variant="outline" onActivate={() => void addLocation()}>
                <Icon name="plus" size={16} /> Add
              </Action>
            </div>

            {locations.length === 0 ? (
              <EmptyState
                title="No locations yet"
                line="Showcase 1, the safe, the counter — where a piece physically sits. A karigar is not a location; gold with a craftsman is a balance (stage 5)."
              />
            ) : (
              locations.map((location) => (
                <div key={location.id} className="summary-line">
                  <span>
                    {location.name}
                    {location.isActive ? null : <span className="badge">off</span>}
                  </span>
                  <span className="summary-line__value">
                    {rowActions('location', location.id, location.name, location.isActive)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {renaming ? (
        <Modal label="Rename" onClose={() => setRenaming(null)}>
          <h2 className="modal__title">Rename &quot;{renaming.current}&quot;</h2>
          <p className="hint">
            The new name appears everywhere the old one did, past records included —
            renaming is relabelling, not rewriting history.
          </p>
          <label className="field">
            <span className="field__label">New name</span>
            <input
              className="input"
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveRename()
              }}
              aria-label="New name"
              autoFocus
            />
          </label>
          <div className="confirm__actions">
            <Action id="setup.rename.cancel" variant="ghost" onActivate={() => setRenaming(null)}>
              Keep the old name
            </Action>
            <Action id="setup.rename.save" variant="primary" onActivate={() => void saveRename()}>
              Rename
            </Action>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
