let activeDropdownClose: (() => void) | null = null;
let activeDropdownId: string | null = null;

export function claimDropdown(id: string, close: () => void) {
  if (activeDropdownId !== id) {
    activeDropdownClose?.();
  }
  activeDropdownId = id;
  activeDropdownClose = close;
  document.dispatchEvent(new CustomEvent("nav-dropdown-open", { detail: id }));
}

export function releaseDropdown(id: string) {
  if (activeDropdownId !== id) return;
  activeDropdownId = null;
  activeDropdownClose = null;
}
