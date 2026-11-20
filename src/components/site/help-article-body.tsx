import type { HelpBodyBlock } from "@/lib/help-center"

/**
 * Renders a help article's structured body. Blocks are data, never HTML —
 * there is intentionally no dangerouslySetInnerHTML here.
 */
export function HelpArticleBody({ body }: { body: readonly HelpBodyBlock[] }) {
  return (
    <div className="doc-block">
      {body.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const Tag = block.level === 2 ? "h2" : "h3"
            return <Tag key={index}>{block.text}</Tag>
          }
          case "list":
            return (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            )
          case "paragraph":
          default:
            return <p key={index}>{block.text}</p>
        }
      })}
    </div>
  )
}
