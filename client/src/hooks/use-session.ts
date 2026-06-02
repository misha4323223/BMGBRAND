import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { useAuth } from './use-auth';
import { queryClient } from '@/lib/queryClient';
import { api } from '@shared/routes';

const GUEST_SESSION_KEY = 'bmg_session_id';

let globalMergedForUser: string | null = null;
let mergeInProgress = false;

function getGuestSessionId(): string {
  let stored = localStorage.getItem(GUEST_SESSION_KEY);
  if (!stored) {
    stored = nanoid();
    localStorage.setItem(GUEST_SESSION_KEY, stored);
  }
  return stored;
}

export function useSession() {
  const { data: authData } = useAuth();
  const user = authData?.user;
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const guestId = getGuestSessionId();

    if (user?.id) {
      const userSessionId = `user_${user.id}`;
      setSessionId(userSessionId);

      if (globalMergedForUser !== userSessionId && !mergeInProgress && guestId !== userSessionId) {
        globalMergedForUser = userSessionId;
        mergeInProgress = true;
        fetch('/api/cart/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ fromSessionId: guestId }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.merged > 0) {
              queryClient.invalidateQueries({ queryKey: [api.cart.list.path] });
            }
          })
          .catch(() => {
            globalMergedForUser = null;
          })
          .finally(() => {
            mergeInProgress = false;
          });
      }
    } else {
      setSessionId(guestId);
      globalMergedForUser = null;
    }
  }, [user?.id]);

  return sessionId;
}
