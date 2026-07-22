// src/router.ts — 基于 hash 的简单路由

export type Route =
  | { name: 'personal' }
  | { name: 'team' }
  | { name: 'task-detail'; taskId: string }
  | { name: 'not-found' };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h === 'personal' || h === '' || !h) return { name: 'personal' };
  if (h === 'team') return { name: 'team' };
  const taskMatch = h.match(/^task\/(.+)$/);
  if (taskMatch) return { name: 'task-detail', taskId: decodeURIComponent(taskMatch[1]) };
  return { name: 'not-found' };
}

export type ViewRenderer = (container: HTMLElement, route: Route) => void | Promise<void>;

export class Router {
  private currentRoute: Route = { name: 'personal' };
  private renderer: ViewRenderer;

  constructor(renderer: ViewRenderer) {
    this.renderer = renderer;
    window.addEventListener('hashchange', () => this.navigate());
  }

  navigate(): void {
    this.currentRoute = parseRoute(location.hash);
    this.updateNav();
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = '';
      Promise.resolve(this.renderer(app, this.currentRoute)).catch(console.error);
    }
  }

  private updateNav(): void {
    document.querySelectorAll('nav a').forEach(a => {
      const href = a.getAttribute('href') || '';
      a.classList.toggle('active', href === `#${this.currentRoute.name === 'personal' ? 'personal' : this.currentRoute.name}`);
    });
  }

  start(): void {
    if (!location.hash) location.hash = '#personal';
    this.navigate();
  }
}
