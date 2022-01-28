/**
 * @fileoverview Renders tables in Markdown with easy indented table syntax.
 * See README and fixtures for examples.
 */

/**
 * Replaces tabs in (multiline) string input with proper number of spaces
 * accounting for tab stop logic.
 * @param {string} input - (Multiline) string input.
 * @param {int} tabsize - Tab stop size in number of spaces. (default: 2)
 */

const replaceTabs = (input, tabsize) => {
  const tabSize = tabsize || 2
  const lines = input.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    let tabPos
    // eslint-disable-next-line
    while (lines[i].search('\t') !== -1) {
      tabPos = lines[i].search('\t')
      const spacesNum = tabSize - (tabPos % tabSize)
      let spaces = ''
      for (let j = 0; j < spacesNum; j++) {
        spaces += ' '
      }
      lines[i] = lines[i].replace(/\t/, spaces)
    }
  }
  return `${lines.join('\n')}`
}

function MarkdownItIndentedTable(md) {
  /**
   * Renders indented tables in Markdown as html.
   * @param {string} code - Markdown table in indented table syntax.
   * @param {int} tabsize - Tab stop size in number of spaces. (default: 2)
   *
   * @returns {string} - Table rendered as html.
   */
  const renderTable = (code, tabsize) => {
    const noTabCode = replaceTabs(code, tabsize)
    const lines = noTabCode.split(/\r?\n/)
    const tableHtml = ['<table>']

    // |1| Empty code returns empty string
    if (!code) return ''

    // |2| Determine number & position of columns from 2+ space runs in first row
    const firstLine = lines[0].trimRight()
    const colIdxs = [0]
    const spaceRuns = [...firstLine.matchAll(/ {2,}/g)]
    spaceRuns.forEach((match) => {
      if (match.index > 0) colIdxs.push(match.index + match[0].length)
    })

    // |3| Determine whether second row is valid header separator
    let hasHeader = false
    const VALID_HEADER_RE = /^[-:][-:\s]*$/
    const secondLine = lines[1] && lines[1].trimRight()

    // |3.1| Must only have '-', ':', and ' ' characters
    if (secondLine && secondLine.match(VALID_HEADER_RE)) {
      const secondLineColChars = []
      colIdxs.forEach((colIdx) => {
        if (secondLine[colIdx]) {
          secondLineColChars.push(secondLine[colIdx])
        } else {
          secondLineColChars.push('X')
        }
      })
      // |3.2| Character beneath each column start must be '-' or ':'
      if (secondLineColChars.every((ch) => ch.match(/[-:]/))) {
        hasHeader = true
      }
    }

    // |4| Prepare to align text according to headers
    const colAligns = []
    if (hasHeader) {
      for (let i = 0; i < colIdxs.length; i++) {
        const start = colIdxs[i]
        const end = i + 1 >= colIdxs.length ? secondLine.length : colIdxs[i + 1]
        const cell = secondLine.substring(start, end).trimRight()

        let colAlign = 'none'
        if (cell[0] === ':') {
          if (cell[cell.length - 1] === '-') colAlign = 'left'
          if (cell[cell.length - 1] === ':') colAlign = 'center'
        } else if (cell[0] === '-') {
          if (cell[cell.length - 1] === ':') colAlign = 'right'
        }
        colAligns.push(colAlign)
      }
    }

    // |5| Open thead or tbody appropriately
    hasHeader ? tableHtml.push('<thead>', '<tr>') : tableHtml.push('<tbody>', '<tr>')

    // |6| Render header or body row for first line
    for (let i = 0; i < colIdxs.length; i++) {
      const start = colIdxs[i]
      const end = i + 1 >= colIdxs.length ? firstLine.length : colIdxs[i + 1]
      const cell = firstLine.substring(start, end).trimRight()
      const mdCell = md.renderInline(cell)
      let openTag
      let closeTag
      if (hasHeader) {
        switch (colAligns[i]) {
          case 'left':
          case 'right':
          case 'center':
            // GitHub(FM) uses deprecated align attribute and strips css, so use both
            openTag = `<th align="${colAligns[i]}" style="text-align:${colAligns[i]}">`
            break
          default:
            openTag = '<th>'
        }
        closeTag = '</th>'
      } else {
        openTag = '<td>'
        closeTag = '</td>'
      }
      tableHtml.push(`${openTag}${mdCell}${closeTag}`)
    }
    tableHtml.push('</tr>')

    // |7| Close header and open body if needed
    if (hasHeader) {
      tableHtml.push('</thead>')
      // Return table when no rows below
      if (lines.length <= 2) {
        tableHtml.push('</table>\n')
        return tableHtml.join('\n')
      }
      tableHtml.push('<tbody>')
    }

    // |8| Render remaining rows one-by-one
    for (let row = hasHeader ? 2 : 1; row < lines.length; row++) {
      const line = lines[row].trimRight()
      tableHtml.push('<tr>')
      for (let i = 0; i < colIdxs.length; i++) {
        const start = colIdxs[i]
        const end = i + 1 >= colIdxs.length ? line.length : colIdxs[i + 1]
        const cell = lines[row].substring(start, end).trimRight()
        const mdCell = md.renderInline(cell)
        let openTag
        let closeTag
        if (hasHeader) {
          switch (colAligns[i]) {
            case 'left':
            case 'right':
            case 'center':
              // GitHub(FM) uses deprecated align attribute and strips css, so use both
              openTag = `<td align="${colAligns[i]}" style="text-align:${colAligns[i]}">`
              break
            default:
              openTag = '<td>'
          }
          closeTag = '</td>'
        } else {
          openTag = '<td>'
          closeTag = '</td>'
        }
        tableHtml.push(`${openTag}${mdCell}${closeTag}`)
      }
      tableHtml.push('</tr>')
    }

    // |9| Close table and return
    tableHtml.push('</tbody>', '</table>\n')
    return tableHtml.join('\n')
  }

  const defaultRenderer = md.renderer.rules.fence.bind(md.renderer.rules)

  md.renderer.rules.fence = (tokens, idx, _options, env, slf) => {
    const token = tokens[idx]
    const code = token.content.trimRight()
    const info = token.info ? md.utils.unescapeAll(token.info).trim() : ''
    const tabsize = _options.tabsize || 2
    let langName = ''

    if (info) {
      ;[langName] = info.split(/\s+/g)
    }

    if (langName === 'table') {
      return renderTable(code, tabsize)
    }

    return defaultRenderer(tokens, idx, _options, env, slf)
  }
}
