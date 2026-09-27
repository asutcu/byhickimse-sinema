/** Statik zemin — animasyonlu blur GPU'yu kilitliyordu. */
export function PanelAtmosphere() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="atmosphere-mesh" />
    </div>
  );
}
