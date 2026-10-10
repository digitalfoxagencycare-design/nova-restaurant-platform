# Nova print agent

A tiny program for the cashier PC. The Nova POS (in the browser) sends it ready-made ESC/POS bytes and it writes them to
the thermal printer. It works with **TVS RP 3200 / RP 3160** and any other ESC/POS receipt printer. No dependencies, nothing to `npm install`.

## Set up on Windows (about 5 minutes)

1. Install the printer's Windows driver (TVS publishes one for each model) and make sure a test page prints from Windows.
2. Install [Node.js](https://nodejs.org) 18 or newer.
3. Copy this `print-agent` folder to the PC, for example `C:\NovaPrint`.
4. Edit `start-agent.bat` and set `PRINT_AGENT_ALLOWED_ORIGINS` to the address of your Nova POS (for example `https://pos.yourrestaurant.com`).
5. Double-click `start-agent.bat`. To start it with Windows, put a shortcut to it in `shell:startup`.
6. Open the POS. The top bar shows **Printer ready**. Go to **Setup > Rules & printers** and press **Print test slip**.

If you have more than one printer, add each one in **Rules & printers** and type its exact Windows name in "Printer name on the PC". Leave it blank and the agent picks a thermal printer by itself.

## Mac and Linux
Uses CUPS (`lp`). Add the printer in your system settings, then run `PRINT_AGENT_ALLOWED_ORIGINS=https://pos.example.com node server.js`.

## Network printers
A printer with an Ethernet port can be driven without Windows drivers: the POS sends `host` (its address on your shop network) and the agent
connects to port 9100. Only private network addresses are accepted.

## Safety
* Listens on `127.0.0.1` only, never on the shop network.
* Only the origins you list can print. A website open in another tab cannot send print jobs. `*` is refused at start-up.
* Print jobs are limited to 256 KB and the printer name is never placed in a shell command.
* Telugu or Hindi text cannot be printed with a plain text job (thermal printers have no such font). Names are transliterated to English letters; image printing is a later phase.

## Test
`npm test` (uses a fake printer that writes the bytes to a file).
