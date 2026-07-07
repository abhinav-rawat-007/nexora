import { motion } from "framer-motion";
import { X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export function Drawer({
  drawerKey,
  title,
  onClose,
  reduceMotion = false,
  width,
  children,
}: {
  drawerKey: string;
  title: string;
  onClose: () => void;
  reduceMotion?: boolean;
  width?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      key={drawerKey}
      className="drawer-layer"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.16 }}
    >
      <button className="drawer-scrim" onClick={onClose} aria-label={`Close ${title}`} />
      <motion.section
        className="drawer-panel"
        style={width ? ({ "--drawer-width": width } as CSSProperties) : undefined}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 34 }}
      >
        <div className="drawer-header">
          <h1>{title}</h1>
          <button className="icon-button drawer-close" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </motion.section>
    </motion.div>
  );
}
