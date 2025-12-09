# 001: Padidinti ir paryškinti pranešimų taškus

**Assigned Agent**: frontend-architect
**Epic**: N/A
**Status**: TO DO
**Estimated Effort**: S (mažas)

## Vision Alignment

Šis patobulinimas pagerina VS Code Favicon naudotojo patirtį - pranešimų taškai bus lengviau pastebimi, kas padės greičiau atkreipti dėmesį į Claude užbaigtas užduotis.

## Objective

Padidinti geltoną ("working") ir žalią ("completed") pranešimų taškus 1.5x nuo dabartinio dydžio ir pakeisti spalvas į ryškesnes, geriau matomas.

## Requirements

- Padidinti taškų radiusą nuo 8px iki 12px (1.5x)
- Pakeisti geltoną spalvą į ryškesnę (pvz., `#FFD700` arba `#FFEB3B`)
- Pakeisti žalią spalvą į ryškesnę (pvz., `#00E676` arba `#32CD32`)
- Taškai turi likti pilnaviduriai (solid fill)
- Atnaujinti stroke plotį proporcingai

## Acceptance Criteria

- [ ] Taškų radiusas padidintas iki 12px (buvo 8px)
- [ ] Geltona spalva pakeista į ryškesnę
- [ ] Žalia spalva pakeista į ryškesnę
- [ ] Taškai aiškiai matomi ant bet kokio fono favicon
- [ ] Animacija (pulse) veikia korektiškai
- [ ] PNG/ICO favicon taip pat atnaujintas su naujais parametrais

## Dependencies

- Depends on: Jokių
- Blocks: Jokių

## Technical Notes

Failai kuriuos reikia modifikuoti:
- `vscode-favicon-extension/content-project-favicon.js`
  - SVG badge: linijos ~795-801 (circle elementas)
  - PNG badge: linijos ~906-919 (canvas arc)
  - Spalvų objektas: linijos ~761-764

Dabartinės reikšmės:
```javascript
// Spalvos (linija ~761)
const colors = {
    working: '#FFC107',   // Geltona - per blankia
    completed: '#4CAF50'  // Žalia - per tamsi
};

// SVG badge (linija ~796-801)
circle.setAttribute('cx', '24');
circle.setAttribute('cy', '8');
circle.setAttribute('r', '8');  // Reikia 12
circle.setAttribute('stroke-width', '2');  // Galima 3

// PNG badge (linija ~913-919)
ctx.arc(24, 8, 8, 0, 2 * Math.PI);  // Reikia radius 12
ctx.lineWidth = 2;  // Galima 3
```

Siūlomos naujos spalvos:
- Geltona: `#FFD700` (Gold) arba `#FFEB3B` (Material Yellow 400)
- Žalia: `#00E676` (Material Green A400) arba `#32CD32` (Lime Green)

## Resources

- `vscode-favicon-extension/content-project-favicon.js` - pagrindinis failas
- Material Design Color Palette: https://materialui.co/colors

## Testing Requirements

- [ ] Vizualus testavimas - ar taškai gerai matomi
- [ ] Testas su skirtingais favicon tipais (SVG, PNG, ICO)
- [ ] Testas su skirtingomis favicon spalvomis

---

**Completion Instructions**:
1. When task is completed, rename file to: `done_001_frontend-architect_enlarge-brighten-notification-dots.md`
2. After testing is verified, rename to: `tested_done_001_frontend-architect_enlarge-brighten-notification-dots.md`
