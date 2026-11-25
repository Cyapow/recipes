// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthGate } from './AuthGate';
import { notifyUnauthorized, rememberSignedIn } from '../lib/session';
import { useMe } from '../lib/me';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  getMe: vi.fn(),
}));
vi.mock('../pages/SignIn', () => ({
  SignIn: ({ onSignedIn }: { onSignedIn: () => void }) => <button onClick={onSignedIn}>sign in as next person</button>,
}));
import { getMe } from '../api';

beforeEach(() => { localStorage.clear(); vi.mocked(getMe).mockReset(); });
afterEach(cleanup);

describe('AuthGate sign-out', () => {
  it('forgets who was signed in, so the next person is not mistaken for them', async () => {
    rememberSignedIn();
    vi.mocked(getMe).mockResolvedValueOnce({ email: 'a@x.com', name: 'Ann' });
    function Who() { return <p>{useMe()?.name ?? 'nobody'}</p>; }
    render(<AuthGate><Who /></AuthGate>);
    expect(await screen.findByText('Ann')).toBeTruthy();

    act(() => notifyUnauthorized());
    // The next person signs in; their getMe has not answered yet.
    vi.mocked(getMe).mockReturnValue(new Promise(() => {}));
    await userEvent.click(await screen.findByText('sign in as next person'));
    expect(screen.getByText('nobody')).toBeTruthy();
    expect(screen.queryByText('Ann')).toBeNull();
  });
});
