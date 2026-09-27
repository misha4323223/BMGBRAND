/**
 * Express 4 не перехватывает rejected promise из async-хендлеров: такой throw
 * уходит в process.on('unhandledRejection') мимо error-middleware — клиент не
 * получает ответ, а в мессенджеры летит «Необработанная ошибка».
 *
 * Патчим Layer.prototype.handle тем же способом, что пакет express-async-errors:
 * Express при регистрации хендлера делает `layer.handle = fn`, наш сеттер
 * заворачивает fn так, чтобы rejection уходил в next(err).
 * `length` завёрнутой функции сохраняем: Express различает обычные хендлеры
 * (не больше 3 аргументов) и error-middleware (ровно 4) именно по длине.
 */
// @ts-ignore — внутренний CJS-модуль express, собственных типов у него нет
import Layer from "express/lib/router/layer.js";

let installed = false;

export function enableExpressAsyncErrors(): void {
  if (installed) return;
  installed = true;

  Object.defineProperty(Layer.prototype, "handle", {
    enumerable: true,
    configurable: true,
    get(this: any) {
      return this.__asyncHandle;
    },
    set(this: any, fn: any) {
      if (typeof fn !== "function") {
        this.__asyncHandle = fn;
        return;
      }

      const wrapped = function (this: any) {
        const args = arguments;
        const result = fn.apply(this, args);
        if (result && typeof result.then === "function") {
          // next — последний аргумент: (req,res,next) или (err,req,res,next)
          const last = args[args.length - 1];
          Promise.resolve(result).catch(typeof last === "function" ? last : args[2]);
        }
        return result;
      };

      try {
        Object.defineProperty(wrapped, "length", { value: fn.length, configurable: true });
      } catch {
        /* length не критичен для работы */
      }

      this.__asyncHandle = wrapped;
    },
  });
}
