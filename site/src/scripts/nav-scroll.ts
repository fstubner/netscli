export function initNavScrollShadow(): void {
const updateNavShadow = () => {
        document.body.classList.toggle('nav-scrolled', window.scrollY > 2);
      };
      updateNavShadow();
      window.addEventListener('scroll', updateNavShadow, { passive: true });
}
