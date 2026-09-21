import { Stage } from './render/stage'
import { Hud } from './ui/hud'
import { Game } from './app/game'
import './style.css'

const app = document.getElementById('app')
const hudRoot = document.getElementById('hud')
if (!app || !hudRoot) throw new Error('missing mount points')

const stage = new Stage(app)
const hud = new Hud(hudRoot)

function resize(): void {
  stage.resize(window.innerWidth, window.innerHeight)
}
resize()
window.addEventListener('resize', resize)

new Game(stage, hud).start()
