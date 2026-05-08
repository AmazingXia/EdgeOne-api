"use client";

import * as React from "react";
import TextareaAutosize, {
  type TextareaAutosizeProps,
} from "react-textarea-autosize";

import { cn } from "@/lib/utils";

/**
 * shadcn 风格的多行输入框，默认开启高度自适应（autosize），与 el-input 体验对齐。
 * 执行流程：① 透传所有原生 textarea 属性 → ② 由 react-textarea-autosize 控制行高 → ③ 通过 ref 暴露原生 textarea 节点。
 */
type AutosizeProps = Omit<TextareaAutosizeProps, "minRows" | "maxRows"> & {
  autosize?: boolean;
  minRows?: number;
  maxRows?: number;
};

const baseClassName =
  "block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-60";

const Textarea = React.forwardRef<HTMLTextAreaElement, AutosizeProps>(
  ({ className, autosize = true, minRows = 2, maxRows, ...rest }, ref) => {
    if (!autosize) {
      const nativeProps = rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>;
      return (
        <textarea
          ref={ref}
          className={cn(baseClassName, "min-h-24 resize-y", className)}
          {...nativeProps}
        />
      );
    }

    return (
      <TextareaAutosize
        ref={ref}
        minRows={minRows}
        maxRows={maxRows}
        className={cn(baseClassName, "resize-none", className)}
        {...rest}
      />
    );
  },
);

Textarea.displayName = "Textarea";

export { Textarea };
