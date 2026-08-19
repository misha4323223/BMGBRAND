import { useState, useEffect, useCallback } from "react";
import { Bell } from "lucide-react";
import { enablePush, disablePush, pushSupported, getPushSubscription, isIosNeedsHomeScreen } from "@/lib/push";

type Status = "idle" | "subscribed" | "denied" | "unsupported" | "pending";

interface Props {
  className?: string;
  iconClassName?: string;
  label?: boolean;
}

export function PushSubscribeButton({ className = "p-1.5 rounded-full", iconClassName = "w-5 h-5", label = false }: Props) {
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    if (!pushSupported()) {
      setStatus("unsupported");
      return;
    }
    getPushSubscription().then((sub) => {
      if (sub) setStatus("subscribed");
      else if (Notification.permission === "denied") setStatus("denied");
      else setStatus("idle");
    });
  }, []);

  const handleClick = useCallback(async () => {
    if (!pushSupported()) {
      setStatus("unsupported");
      return;
    }
    if (status === "subscribed") {
      await disablePush();
      setStatus("idle");
      return;
    }
    if (status === "pending") return;
    setStatus("pending");
    const r = await enablePush();
    setStatus(
      r === "subscribed" ? "subscribed" :
      r === "denied" ? "denied" :
      r === "unsupported" ? "unsupported" :
      "idle"
    );
  }, [status]);

  if (status === "unsupported") return null;

  const iosHint = isIosNeedsHomeScreen();
  const title =
    status === "subscribed"
      ? "Уведомления включены. Нажмите, чтобы отключить"
      : status === "denied"
        ? "Уведомления заблокированы браузером. Включите их в настройках сайта"
        : iosHint
          ? "На iPhone добавьте сайт на экран «Домой», чтобы получать уведомления"
          : "Включить уведомления о новинках";

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      aria-label={title}
      data-testid="button-push-subscribe"
      className={`inline-flex items-center justify-center transition-colors gap-2 ${
        status === "subscribed"
          ? "bg-primary/10 text-primary"
          : "text-foreground/70 hover:text-foreground hover:bg-muted"
      } ${className}`}
    >
      <Bell className={iconClassName} />
      {label && (
        <span className="text-sm font-medium hidden sm:inline">
          {status === "subscribed" ? "Уведомления включены" : "Включить уведомления о дропах"}
        </span>
      )}
    </button>
  );
}
