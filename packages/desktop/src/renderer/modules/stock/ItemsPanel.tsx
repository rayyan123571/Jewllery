import { useCallback, useEffect, useState } from 'react'
import { PURITIES, formatPurity } from '@jewellery/domain'
import { Action } from '../../actions/Action.js'
import { Icon } from '../../shell/Icon.js'
import { EmptyState } from '../../components/EmptyState.js'
import { useMessages } from '../../components/Messages.js'
import { Modal } from '../../components/Modal.js'
import { PartySelector } from '../wholesale/PartySelector.js'
import type { CategoryNodeDto, ItemDto, PartyDto, SaveItemRequest } from '../../../shared/ipc.js'

/**
 * The item master: the register of what the shop sells, by definition.
 *
 * No weight and no quantity anywhere on this screen, deliberately — an item is
 * "22K ladies ring, design R-114", and what the shop HOLDS is the pieces
 * (stage 2), each with its own weight. This register is what a piece will be
 * tagged as, and what a sale line will start from.
 */

interface ItemForm {
  readonly itemId: string | null
  readonly code: string
  readonly name: string
  readonly categoryTopId: string
  readonly categorySubId: string
  readonly purity: string
  readonly defaultKattRatti: string
  readonly makingChargeBasis: string
  readonly makingChargeRupees: string
  readonly supplier: PartyDto | null
  readonly designNo: string
  readonly notes: string
}

const EMPTY_FORM: ItemForm = {
  itemId: null,
  code: '',
  name: '',
  categoryTopId: '',
  categorySubId: '',
  purity: 'K22',
  defaultKattRatti: '',
  makingChargeBasis: 'per_tola',
  makingChargeRupees: '',
  supplier: null,
  designNo: '',
  notes: '',
}

export function ItemsPanel() {
  const [query, setQuery] = useState('')
  /** The query the list actually asks with — the typed one, 150 ms later. */
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [items, setItems] = useState<readonly ItemDto[]>([])
  const [tree, setTree] = useState<readonly CategoryNodeDto[]>([])
  const [form, setForm] = useState<ItemForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { push } = useMessages()

  // The same 150 ms the party selector earned: a fast typist fires one query
  // per pause rather than one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150)
    return () => clearTimeout(timer)
  }, [query])

  const refresh = useCallback(async () => {
    const [nextItems, nextTree] = await Promise.all([
      window.api.inventoryItems(debouncedQuery, showInactive),
      window.api.inventoryCategoryTree(false),
    ])
    setItems(nextItems)
    setTree(nextTree)
  }, [debouncedQuery, showInactive])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const set = (patch: Partial<ItemForm>): void => {
    setForm((current) => (current ? { ...current, ...patch } : current))
    setFormError(null)
  }

  const openAdd = useCallback(() => {
    setForm({ ...EMPTY_FORM })
    setFormError(null)
  }, [])

  const openEdit = useCallback(
    (item: ItemDto) => {
      // The tree splits the stored category back into the two dropdowns.
      let topId = ''
      let subId = ''
      for (const node of tree) {
        if (node.id === item.categoryId) topId = node.id
        for (const child of node.children) {
          if (child.id === item.categoryId) {
            topId = node.id
            subId = child.id
          }
        }
      }
      setForm({
        itemId: item.id,
        code: item.code,
        name: item.name,
        categoryTopId: topId,
        categorySubId: subId,
        purity: item.purity,
        defaultKattRatti: item.defaultKattDisplay === '0.000' ? '' : item.defaultKattDisplay,
        makingChargeBasis: item.makingChargeBasis,
        makingChargeRupees: item.makingChargeRupees,
        supplier: item.supplierId
          ? { id: item.supplierId, code: '', name: item.supplierName, mobile: null, city: null }
          : null,
        designNo: item.designNo ?? '',
        notes: item.notes ?? '',
      })
      setFormError(null)
    },
    [tree],
  )

  const save = useCallback(async () => {
    if (!form || saving) return
    setSaving(true)
    try {
      const request: SaveItemRequest = {
        code: form.code,
        name: form.name,
        // The sub-category wins when chosen; the top level files it broadly.
        categoryId: form.categorySubId || form.categoryTopId || null,
        purity: form.purity,
        defaultKattRatti: form.defaultKattRatti,
        makingChargeBasis: form.makingChargeBasis,
        makingChargeRupees: form.makingChargeRupees,
        supplierId: form.supplier?.id ?? null,
        designNo: form.designNo,
        notes: form.notes,
      }
      const result = form.itemId
        ? await window.api.inventoryItemUpdate(form.itemId, request)
        : await window.api.inventoryItemCreate(request)
      if (!result.ok) {
        setFormError(result.message)
        return
      }
      push('ok', `Saved ${result.item.code} — ${result.item.name}.`)
      setForm(null)
      await refresh()
    } finally {
      setSaving(false)
    }
  }, [form, saving, refresh, push])

  const toggleActive = useCallback(
    async (item: ItemDto) => {
      const result = await window.api.inventoryItemSetActive(item.id, !item.isActive)
      if (!result.ok) {
        push('bad', result.message)
        return
      }
      push(
        'ok',
        item.isActive
          ? `${item.code} is deactivated. It stays on old records; new pieces cannot use it.`
          : `${item.code} is active again.`,
      )
      await refresh()
    },
    [refresh, push],
  )

  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'item.add': openAdd,
      'item.save': () => void save(),
      'item.cancel': () => setForm(null),
      'item.inactive.show': () => setShowInactive((current) => !current),
    }
    const listener = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      handlers[id]?.()
    }
    window.addEventListener('jewellery:action', listener)
    return () => window.removeEventListener('jewellery:action', listener)
  }, [openAdd, save])

  const subChoices =
    tree.find((node) => node.id === (form?.categoryTopId ?? ''))?.children ?? []

  return (
    <>
      <div className="panel__body">
        <div className="field-row">
          <label className="field">
            <span className="field__label">Search</span>
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Code, name or design"
              aria-label="Search items"
            />
          </label>
          <span className="toolbar__end">
            <Action
              id="item.inactive.show"
              variant="toolbar"
              active={showInactive}
              onActivate={() => setShowInactive((current) => !current)}
            >
              {showInactive ? 'Hiding nothing' : 'Show deactivated'}
            </Action>
            <Action id="item.add" variant="primary" onActivate={openAdd}>
              <Icon name="plus" size={16} /> Add Item
            </Action>
          </span>
        </div>

        {items.length === 0 ? (
          <EmptyState
            title={query ? 'Nothing matches' : 'No items yet'}
            line={
              query
                ? 'No item code, name or design matches what you typed.'
                : 'The item master is the register of what the shop sells — "22K ladies ring, design R-114". Add the first one; pieces (with weights) come in on top of it.'
            }
            actionId="item.add"
            actionLabel="Add Item"
          />
        ) : (
          <div className="table-scroll">
            <table className="grid grid--fixed">
              <colgroup>
                <col className="col--rate" />
                <col />
                <col className="col--remarks" />
                <col className="col--katt" />
                <col className="col--katt" />
                <col className="col--rate" />
                <col className="col--rate" />
                <col className="col--action" />
              </colgroup>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Purity</th>
                  <th className="numeric">Katt r/t</th>
                  <th className="numeric">Making</th>
                  <th>Supplier</th>
                  <th className="grid__action">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.isActive ? undefined : 'row--reversed'}>
                    <td>{item.code}</td>
                    <td title={item.notes ?? undefined}>
                      {item.name}
                      {item.designNo ? <span className="muted"> · {item.designNo}</span> : null}
                      {item.isActive ? null : <span className="badge">off</span>}
                    </td>
                    <td>{item.categoryLabel}</td>
                    <td>{item.purityDisplay}</td>
                    <td className="numeric">{item.defaultKattDisplay}</td>
                    <td className="numeric">{item.makingChargeDisplay}</td>
                    <td>{item.supplierName || '—'}</td>
                    <td className="grid__action">
                      <span className="bucket-action">
                        <Action
                          id="item.edit"
                          variant="icon"
                          ariaLabel={`Edit ${item.code}`}
                          onActivate={() => openEdit(item)}
                        >
                          <Icon name="eye" size={16} />
                        </Action>
                        <Action
                          id="item.active.toggle"
                          variant="icon"
                          {...(item.isActive ? { className: 'is-danger' } : {})}
                          ariaLabel={
                            item.isActive ? `Deactivate ${item.code}` : `Activate ${item.code}`
                          }
                          onActivate={() => void toggleActive(item)}
                        >
                          <Icon name={item.isActive ? 'cross' : 'plus'} size={16} />
                        </Action>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form ? (
        <Modal
          label={form.itemId ? 'Edit item' : 'Add item'}
          onClose={() => setForm(null)}
          wide
        >
          <h2 className="modal__title">{form.itemId ? `Edit ${form.code}` : 'New item'}</h2>
          <p className="hint">
            An item is a definition — no weight, no quantity. The weights arrive with the
            pieces tagged against it.
          </p>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Code</span>
              <input
                className={`input${form.itemId ? ' input--derived' : ''}`}
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
                placeholder="e.g. R-114"
                aria-label="Item code"
                readOnly={form.itemId !== null}
                disabled={form.itemId !== null}
              />
              {form.itemId ? (
                <span className="field__hint">Codes print on tags, so they never change.</span>
              ) : null}
            </label>
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="input"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. 22K ladies ring"
                aria-label="Item name"
              />
            </label>
            <label className="field">
              <span className="field__label">Design / model</span>
              <input
                className="input"
                value={form.designNo}
                onChange={(e) => set({ designNo: e.target.value })}
                placeholder="—"
                aria-label="Design number"
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Category</span>
              <select
                className="input"
                value={form.categoryTopId}
                onChange={(e) => set({ categoryTopId: e.target.value, categorySubId: '' })}
                aria-label="Item category"
              >
                <option value="">Not filed</option>
                {tree.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Sub-category</span>
              <select
                className="input"
                value={form.categorySubId}
                onChange={(e) => set({ categorySubId: e.target.value })}
                aria-label="Item sub-category"
                disabled={subChoices.length === 0}
              >
                <option value="">{subChoices.length === 0 ? '—' : 'None'}</option>
                {subChoices.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Purity</span>
              <select
                className="input"
                value={form.purity}
                onChange={(e) => set({ purity: e.target.value })}
                aria-label="Item purity"
              >
                {PURITIES.map((purity) => (
                  <option key={purity} value={purity}>
                    {formatPurity(purity)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Default katt (r/t)</span>
              <input
                className="input input--numeric"
                value={form.defaultKattRatti}
                onChange={(e) => set({ defaultKattRatti: e.target.value })}
                placeholder="0.000"
                inputMode="decimal"
                aria-label="Default katt"
              />
              <span className="field__hint">
                Pre-fills a new piece. Every piece still records its own.
              </span>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Making charge</span>
              <select
                className="input"
                value={form.makingChargeBasis}
                onChange={(e) => set({ makingChargeBasis: e.target.value })}
                aria-label="Making charge basis"
              >
                <option value="per_tola">Per tola</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Usual amount (Rs)</span>
              <input
                className="input input--numeric"
                value={form.makingChargeRupees}
                onChange={(e) => set({ makingChargeRupees: e.target.value })}
                placeholder="0.00"
                inputMode="decimal"
                aria-label="Making charge amount"
              />
            </label>
            <PartySelector
              selected={form.supplier}
              onSelect={(supplier) => set({ supplier })}
              variant="field"
              label="Supplier"
            />
          </div>

          <label className="field">
            <span className="field__label">Notes</span>
            <input
              className="input"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="—"
              aria-label="Item notes"
            />
          </label>

          {formError ? (
            <p className="hint hint--bad" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="confirm__actions">
            <Action id="item.cancel" variant="ghost" onActivate={() => setForm(null)}>
              Cancel
            </Action>
            <Action id="item.save" variant="primary" busy={saving} onActivate={() => void save()}>
              {form.itemId ? 'Save Changes' : 'Add Item'}
            </Action>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
