import { render } from '@testing-library/react';
import { SwRegister } from '@/components/SwRegister';
import { existsSync } from 'fs';
import { resolve } from 'path';

describe('SwRegister', () => {
  it('registers service worker when serviceWorker is available', () => {
    const registerSpy = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: registerSpy },
      configurable: true,
    });

    render(<SwRegister />);
    expect(registerSpy).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('renders nothing (null)', () => {
    const { container } = render(<SwRegister />);
    expect(container.firstChild).toBeNull();
  });
});

describe('PWA manifest file', () => {
  it('manifest.webmanifest exists in public/', () => {
    const manifestPath = resolve(process.cwd(), 'public/manifest.webmanifest');
    expect(existsSync(manifestPath)).toBe(true);
  });

  it('sw.js exists in public/', () => {
    const swPath = resolve(process.cwd(), 'public/sw.js');
    expect(existsSync(swPath)).toBe(true);
  });

  it('manifest has required PWA fields', async () => {
    const manifestPath = resolve(process.cwd(), 'public/manifest.webmanifest');
    const { readFileSync } = await import('fs');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    expect(manifest.name).toBe('MoneyPulse');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons).toHaveLength(3);
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });
});
