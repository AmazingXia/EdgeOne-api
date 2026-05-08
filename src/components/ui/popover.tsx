"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

/**
 * shadcn 风格的 Popover：基于 Radix Popover 的轻量封装。
 * 执行流程：① Trigger 触发 → ② Portal 挂载 Content → ③ 提供默认动画/位移与样式 → ④ 业务可覆盖类名与对齐方式。
 */

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

type PopoverContentProps = React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
>;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(({ className, align = "start", sideOffset = 8, ...rest }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "popover-content z-50 w-(--radix-popover-trigger-width) rounded-2xl border border-slate-200 bg-white p-2 text-slate-900 shadow-xl outline-none",
        className,
      )}
      {...rest}
    />
  </PopoverPrimitive.Portal>
));

PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
