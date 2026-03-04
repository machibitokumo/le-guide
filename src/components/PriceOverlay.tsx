"use client";

import { useState, useRef, useEffect } from "react";
import type { OCRItem } from "@/types/receipt";

interface PriceOverlayProps {
  item: OCRItem;
  onEdit: (itemId: string, newValue: number) => void;
  isEdited: boolean;
}

export default function PriceOverlay({ item, onEdit, isEdited }: PriceOverlayProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(item.value?.toString() ?? item.text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = () => {
    if (item.type === "price" || item.type === "total") {
      setIsEditing(true);
    }
  };

  const handleSubmit = () => {
    const parsed = parseFloat(inputValue.replace(",", "."));
    if (!isNaN(parsed) && parsed !== item.value) {
      onEdit(item.id, parsed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
    if (e.key === "Escape") setIsEditing(false);
  };

  const isClickable = item.type === "price" || item.type === "total";

  return (
    <div
      className="absolute group"
      style={{
        left: `${item.boundingBox.x * 100}%`,
        top: `${item.boundingBox.y * 100}%`,
        width: `${item.boundingBox.width * 100}%`,
        height: `${item.boundingBox.height * 100}%`,
      }}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          className="
            absolute inset-0 w-full h-full
            bg-accent/90 text-white text-xs font-mono
            border border-accent rounded px-1
            outline-none
          "
          style={{ fontSize: "clamp(10px, 1.2vw, 14px)" }}
        />
      ) : (
        <button
          onClick={handleClick}
          disabled={!isClickable}
          className={`
            absolute inset-0 w-full h-full rounded transition-all duration-150
            ${isClickable
              ? "hover:bg-accent/20 hover:ring-1 hover:ring-accent cursor-pointer"
              : "cursor-default"
            }
            ${isEdited
              ? "bg-success/20 ring-1 ring-success"
              : ""
            }
          `}
          title={isClickable ? `Click to edit: ${item.text}` : item.text}
        >
          {isEdited && (
            <span
              className="absolute -top-5 left-0 text-[10px] text-success bg-background/80 px-1 rounded whitespace-nowrap"
            >
              {item.text} → {inputValue}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
