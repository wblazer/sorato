import type { Component } from 'svelte'
import type { MessageIconName } from '@sorato/core/presentation'
import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon'
import ChatCircleTextIcon from 'phosphor-svelte/lib/ChatCircleTextIcon'
import FileMagnifyingGlassIcon from 'phosphor-svelte/lib/FileMagnifyingGlassIcon'
import FilePlusIcon from 'phosphor-svelte/lib/FilePlusIcon'
import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon'
import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon'
import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon'
import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon'
import RobotIcon from 'phosphor-svelte/lib/RobotIcon'
import TerminalIcon from 'phosphor-svelte/lib/TerminalIcon'
import UserIcon from 'phosphor-svelte/lib/UserIcon'
import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon'

export const messageIcons = {
  tool: WrenchIcon,
  'tool-result': CheckCircleIcon,
  'file-text': FileTextIcon,
  'file-plus': FilePlusIcon,
  search: MagnifyingGlassIcon,
  'file-search': FileMagnifyingGlassIcon,
  edit: PencilSimpleIcon,
  terminal: TerminalIcon,
  globe: GlobeIcon,
} satisfies Record<MessageIconName, Component>

export const roleIcons = {
  user: UserIcon,
  assistant: RobotIcon,
  tool: WrenchIcon,
  system: ChatCircleTextIcon,
  summary: FileTextIcon,
} satisfies Record<string, Component>

export function iconForMessageName(name: MessageIconName | undefined) {
  return name ? messageIcons[name] : undefined
}
