# Build setups with Claude

The Optical Workbench MCP server lets Claude build an optical setup from a description in a chat. Claude places each part on a post holder at the beam height and aims the mirrors and splitters. It draws physical beams through the parts and reads back the beam size, focus, power and detector signal. The setup shows up live in the workbench in your browser. Any change you make there goes back to Claude.

It runs on your own computer: Claude Desktop or Claude Code starts it when needed. Nothing is sent anywhere except to Claude.

## Connect it

### Claude Desktop, as an extension (no Node.js needed)

1. Download `Optical_Workbench.mcpb` from the website ("Download Claude extension"). You can also build it with `npm run build:mcp`, which writes it to `dist/`.
2. Double-click the file, or drag it into Claude Desktop under **Settings → Extensions**, then choose **Install**.
3. In a new chat, ask Claude to build a setup.

### Claude Code

From the Optical Workbench folder (Node.js 24, after `npm ci` and `node build.mjs` for the live view):

```
claude mcp add optical-workbench -- node /full/path/to/Optical_Workbench_Claude_Handoff/mcp/server.mjs
```

### Claude Desktop, by hand

Add this to `claude_desktop_config.json` (**Settings → Developer → Edit Config**), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "optical-workbench": {
      "command": "node",
      "args": ["/full/path/to/Optical_Workbench_Claude_Handoff/mcp/server.mjs"]
    }
  }
}
```

The server runs locally, so it does not work with Claude on the web or the mobile apps.

## Try it

> Make a mid-IR gas sensing setup on the MB1218 board. Start with the NanoPlus laser at 4.5 µm and 25 mW. Then a 100 mm CaF₂ lens, a 30 % beam splitter, and a mirror turning the beam towards the front. Next a 30-pass multipass cell with 80 mm per pass and 1000 ppm of gas. Then a mirror, a parabolic mirror and an OD 1 ND filter, and a VIGO detector at 300 V/W. Put a fibre port on the splitter's other arm.

> Move the detector to the focus. How much signal does the gas give?

> Swap the lens for a 75 mm one, and show me the top view.

> The cell mirrors have a 100 mm radius. How many passes does it really make, and what pass count gives the strongest gas signal? Optimise the setup for that.

> Save it as gas-cell.optics.json.

The first change opens the workbench in your browser at `http://127.0.0.1:4180/`. It follows each change as Claude makes it. You can drag parts, change settings or undo there, and Claude sees the result the next time it reads the setup. When the workbench is open, Claude can also take a picture of it (`view_workbench`).

## Tools

| Tool | What it does |
| --- | --- |
| `list_components` | Lists the parts, their sizes, and every optical setting with its units. |
| `new_setup` | Starts an empty setup on a breadboard, with an optional beam height. |
| `build_beam_path` | Lays out a whole beam path from a laser (or a splitter's second arm). You give distances and turns; it places, mounts and aims each part, then draws a physical beam. |
| `add_component`, `edit_component`, `remove_component` | Place, move, turn, rename, retune, lock or remove one part. Its holder moves with it. |
| `add_beam`, `remove_beam` | Draw or remove a beam through parts that are already placed. |
| `analyze_setup` | Traces each beam. It starts with a plain-language summary, then gives diameter, focus and waist, power after each loss, gas absorption, multipass cell numbers, detector power and signal, fibre coupling, alignment sensitivity and warnings. It ends with what `optimize_setup` could gain. Also checks for collisions and parts over the board edge. |
| `optimize_setup` | Improves a beam for a goal: the strongest gas signal, the most light at the end, or the smallest spot. It slides lenses, windows, filters, cells and the end part along the beam and picks a multipass cell's pass count, making the smallest changes that get close to the best. Locked parts stay put. `apply: false` only reports the proposal. |
| `move_to_focus` | Slides the detector, fibre port or pinhole at the end of a beam to the focus. |
| `view_workbench`, `open_workbench` | Takes a picture of the 3D workbench, or opens it in the browser. |
| `save_setup`, `open_setup` | Saves or opens `.optics.json` files. Saved files carry the part models, so the app opens them anywhere. |
| `undo` | Undoes the last change, whether Claude or you made it. |

## Coordinates

Positions are in mm on the board as seen from above. x runs to the right, z runs towards the front, and the board is centred on (0, 0). Directions are compass angles: 0° = right, 90° = back, 180° = left, 270° = front. A left turn is +90° and a right turn is −90°.

A part's position is its optical point, where the beam meets it. The default beam height is 76 mm, which suits the standard holders.

For a mirror, the optical point is on its reflecting surface, and the mount and adjusters sit behind it. Setups made with the first release had flat mirrors turned back to front and parabolic mirrors 45° out. The server turns those mirrors round when it opens such a setup, keeping every bounce point and the beam unchanged. Their mounts now sit behind the beam, so a mirror at a board corner may need moving in from the edge.

## Multipass cells

For a multipass cell, `length` is the mirror spacing and `passes` is the pass count. The analysis gives these numbers:
- the path through the gas, and how many times longer it is than one pass;
- how much stronger the gas signal is than one pass gives, once the light lost at each mirror bounce is counted;
- the pass count that gives the strongest signal with those mirrors.

Set `mirrorRoc`, the mirrors' radius of curvature, to use the real Herriott geometry. The spots then turn by θ each pass, where cos θ = 1 − spacing/R. The beam leaves through the coupling hole (`aperture`) after N passes when N·θ is a whole number of turns. `passes` becomes the target count, and the analysis gives the spacing that reaches it. It also gives how many passes fit before neighbouring spots reach the hole.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPTICAL_WORKBENCH_PORT` | 4180 | First port to try for the live view. |
| `OPTICAL_WORKBENCH_OPEN` | 1 | Set to 0 to stop the browser opening on its own. |
| `OPTICAL_WORKBENCH_SAVE_DIR` | `~/Documents/Optical Workbench` | Where `save_setup` writes files when no path is given. |
| `OPTICAL_WORKBENCH_HOME` | `~/.optical-workbench` | Where the current setup is kept between sessions. |

The live view listens on 127.0.0.1 only. Its address carries a random key, so other websites cannot read or change the setup.
