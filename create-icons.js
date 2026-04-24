const sharp = require('sharp')
const path = require('path')

const sizes = [192, 512]

const svg = (size) => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="#534AB7"/>
  <text x="50%" y="55%" font-family="Arial" font-size="${size * 0.45}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">КК</text>
</svg>`)

async function createIcons() {
  for (const size of sizes) {
    await sharp(svg(size))
      .png()
      .toFile(path.join('public', 'icons', `icon-${size}.png`))
    console.log(`Создана иконка ${size}x${size}`)
  }
  console.log('Готово!')
}

createIcons()