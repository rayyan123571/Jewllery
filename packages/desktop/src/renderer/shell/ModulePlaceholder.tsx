import { moduleById, type ModuleId } from './modules.js'

/**
 * What an unbuilt module shows.
 *
 * Navigating to a module that is not built has to lead somewhere honest.
 * A blank screen reads as a crash; a screen that names the milestone reads as
 * a plan. That is the same reasoning as the disabled controls: unfinished work
 * should be visible as unfinished, never mistaken for broken.
 */
export function ModulePlaceholder({ id }: { id: ModuleId }) {
  const module = moduleById(id)
  const built = module.builtIn === null

  return (
    <div className="placeholder">
      <div>
        <div className="placeholder__badge">
          {built ? 'Screen not built yet' : `Coming in ${module.builtIn}`}
        </div>
        <div className="placeholder__title">{module.label}</div>
        <p style={{ maxWidth: 420, margin: '0 auto' }}>
          {built
            ? 'The underlying feature is built and working. This screen has not been ' +
              'drawn yet, so its controls are disabled.'
            : `This module is planned for ${module.builtIn}. It appears here from day ` +
              'one so the shape of the application is visible, and its controls are ' +
              'disabled rather than silently doing nothing.'}
        </p>
      </div>
    </div>
  )
}
