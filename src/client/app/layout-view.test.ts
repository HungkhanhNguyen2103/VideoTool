import { describe, expect, it } from 'vitest';
import { layoutNavigationState } from './layout-view';

describe('layout navigation state', () => {
  it('activates production navigation only for production routes', () => {
    expect(layoutNavigationState('/production/init')).toEqual({ productionActive: true, analyticsActive: false, showProjectChrome: true });
    expect(layoutNavigationState('/production/project-1/seo')).toEqual({ productionActive: true, analyticsActive: false, showProjectChrome: true });
  });

  it('activates analytics for the hub and channel pages while hiding project chrome', () => {
    expect(layoutNavigationState('/analytics')).toEqual({ productionActive: false, analyticsActive: true, showProjectChrome: false });
    expect(layoutNavigationState('/channels/channel-1/analytics')).toEqual({ productionActive: false, analyticsActive: true, showProjectChrome: false });
  });
});
