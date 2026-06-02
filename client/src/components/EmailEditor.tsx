import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight,
  Link as LinkIcon, Image as ImageIcon,
  Minus, Undo, Redo, RemoveFormatting,
} from "lucide-react";

interface EmailEditorProps {
  value: string;
  onChange: (html: string) => void;
  apiKey: string;
}

export default function EmailEditor({ value, onChange, apiKey }: EmailEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Image.configure({ inline: false, allowBase64: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[220px] p-3",
      },
    },
  });

  const uploadImage = useCallback(async (file: File) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch("/api/admin/upload-email-image", {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "x-api-key": apiKey,
        },
        body: buffer,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      if (data.url && editor) {
        editor.chain().focus().setImage({ src: data.url, alt: file.name }).run();
      }
    } catch (e) {
      alert("Не удалось загрузить изображение");
    } finally {
      uploadingRef.current = false;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [editor, apiKey]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadImage(file);
  };

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href || "";
    const url = window.prompt("Ссылка (URL):", prev);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().setLink({ href: url, target: "_blank" }).run();
    }
  };

  if (!editor) return null;

  const btn = (active: boolean, onClick: () => void, icon: React.ReactNode, title: string) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="border rounded-md overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-1.5 border-b bg-muted/30">
        {/* История */}
        {btn(false, () => editor.chain().focus().undo().run(), <Undo className="w-4 h-4" />, "Отменить")}
        {btn(false, () => editor.chain().focus().redo().run(), <Redo className="w-4 h-4" />, "Повторить")}

        <div className="w-px h-5 bg-border mx-1" />

        {/* Форматирование текста */}
        {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold className="w-4 h-4" />, "Жирный")}
        {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic className="w-4 h-4" />, "Курсив")}
        {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon className="w-4 h-4" />, "Подчёркнутый")}
        {btn(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), <Strikethrough className="w-4 h-4" />, "Зачёркнутый")}

        <div className="w-px h-5 bg-border mx-1" />

        {/* Заголовки */}
        {btn(editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <Heading1 className="w-4 h-4" />, "Заголовок 1")}
        {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 className="w-4 h-4" />, "Заголовок 2")}
        {btn(editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), <Heading3 className="w-4 h-4" />, "Заголовок 3")}

        <div className="w-px h-5 bg-border mx-1" />

        {/* Списки */}
        {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List className="w-4 h-4" />, "Маркированный список")}
        {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered className="w-4 h-4" />, "Нумерованный список")}

        <div className="w-px h-5 bg-border mx-1" />

        {/* Выравнивание */}
        {btn(editor.isActive({ textAlign: "left" }), () => editor.chain().focus().setTextAlign("left").run(), <AlignLeft className="w-4 h-4" />, "По левому краю")}
        {btn(editor.isActive({ textAlign: "center" }), () => editor.chain().focus().setTextAlign("center").run(), <AlignCenter className="w-4 h-4" />, "По центру")}
        {btn(editor.isActive({ textAlign: "right" }), () => editor.chain().focus().setTextAlign("right").run(), <AlignRight className="w-4 h-4" />, "По правому краю")}

        <div className="w-px h-5 bg-border mx-1" />

        {/* Разделитель */}
        {btn(false, () => editor.chain().focus().setHorizontalRule().run(), <Minus className="w-4 h-4" />, "Разделитель")}

        {/* Ссылка */}
        {btn(editor.isActive("link"), setLink, <LinkIcon className="w-4 h-4" />, "Ссылка")}

        {/* Цвет текста */}
        <label title="Цвет текста" className="relative p-1.5 rounded cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <span className="text-xs font-bold leading-none select-none" style={{ fontFamily: "serif" }}>A</span>
          <input
            type="color"
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            title="Цвет текста"
          />
        </label>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Загрузка изображения */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          title="Вставить изображение"
        >
          <ImageIcon className="w-4 h-4" />
          Фото
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-email-image-upload"
        />

        {/* Очистить форматирование */}
        {btn(false, () => editor.chain().focus().unsetAllMarks().clearNodes().run(), <RemoveFormatting className="w-4 h-4" />, "Очистить форматирование")}
      </div>

      {/* Редактор */}
      <EditorContent
        editor={editor}
        className="bg-background [&_.ProseMirror]:min-h-[220px] [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-3 [&_.ProseMirror]:focus:outline-none [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded [&_.ProseMirror_img]:my-2 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_a]:text-blue-600 [&_.ProseMirror_a]:underline [&_.ProseMirror_hr]:border-border [&_.ProseMirror_hr]:my-4 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
        data-testid="email-editor-content"
      />
    </div>
  );
}
