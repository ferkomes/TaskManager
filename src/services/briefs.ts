import { TaskRecord, WaitingItem } from '../types';

export interface MorningBrief {
  generated_at: string;
  headline: string;
  critical: TaskRecord[];
  important_today: TaskRecord[];
  can_wait: TaskRecord[];
  waiting_for_others: WaitingItem[];
  push_notification_preview: {
    title: string;
    body: string;
  };
}

export interface EveningReview {
  generated_at: string;
  headline: string;
  tasks_left_open: Array<{
    task: TaskRecord;
    estimated_time_minutes: number;
    quick_close_suggestion: string;
  }>;
  total_remaining_minutes: number;
  push_notification_preview: {
    title: string;
    body: string;
  };
}

export class BriefService {
  generateMorningBrief(tasks: TaskRecord[], waitingItems: WaitingItem[]): MorningBrief {
    const activeTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'ignored' && (!t.snoozed_until || Date.parse(t.snoozed_until) <= Date.now()));
    
    const critical = activeTasks.filter((t) => t.priority === 'CRITICAL' || t.urgent_flag);
    const importantToday = activeTasks.filter(
      (t) => !critical.some(c => c.id === t.id) && (t.priority === 'HIGH' || t.status === 'now' || t.status === 'today')
    );
    const canWait = activeTasks.filter(
      (t) => t.priority !== 'CRITICAL' && t.priority !== 'HIGH' && (t.status === 'tomorrow' || t.status === 'next_7_days' || t.status === 'later')
    );
    const activeWaiting = waitingItems.filter((w) => w.status === 'active');

    const totalActive = activeTasks.length;
    const headline = critical.length > 0
      ? `🚨 ${critical.length} Critical issue requires your immediate action.`
      : `☀️ Good morning! You have ${importantToday.length} items for today.`;

    const bodyText = [
      critical.length > 0 ? `• CRITICAL: ${critical[0].title}` : null,
      importantToday.length > 0 ? `• Today: ${importantToday.length} priority tasks` : null,
      activeWaiting.length > 0 ? `• Waiting on: ${activeWaiting.length} partners` : null,
    ].filter(Boolean).join('\n');

    return {
      generated_at: new Date().toISOString(),
      headline,
      critical,
      important_today: importantToday,
      can_wait: canWait,
      waiting_for_others: activeWaiting,
      push_notification_preview: {
        title: critical.length > 0 ? 'MyBrain: Critical Action Required' : 'MyBrain: Morning Brief',
        body: bodyText || 'All clear for this morning!',
      },
    };
  }

  generateEveningReview(tasks: TaskRecord[]): EveningReview {
    const activeTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'ignored' && (!t.snoozed_until || Date.parse(t.snoozed_until) <= Date.now()));
    
    const items = activeTasks.slice(0, 5).map((task) => {
      // Intelligently estimate time based on title and recommended action
      let est = 5;
      const lower = (task.title + ' ' + task.suggested_action).toLowerCase();
      if (lower.includes('reply') || lower.includes('válasz') || lower.includes('email')) est = 3;
      else if (lower.includes('approve') || lower.includes('jóváhagyás') || lower.includes('confirm')) est = 2;
      else if (lower.includes('quote') || lower.includes('ajánlat') || lower.includes('konfiguráció')) est = 10;
      else if (lower.includes('check') || lower.includes('review')) est = 4;

      return {
        task,
        estimated_time_minutes: est,
        quick_close_suggestion: task.draft_reply ? 'Approve prepared draft and mark as done' : 'Postpone to Tomorrow 09:00',
      };
    });

    const totalMinutes = items.reduce((acc, curr) => acc + curr.estimated_time_minutes, 0);

    const headline = items.length === 0
      ? '🎉 All done for today! Zero tasks pending.'
      : `🌙 Esti AI Review: ${items.length} nyitott feladat maradt (~${totalMinutes} perc)`;

    const lines = items.slice(0, 3).map(i => `• ${i.task.title} (~${i.estimated_time_minutes} min)`).join('\n');

    return {
      generated_at: new Date().toISOString(),
      headline,
      tasks_left_open: items,
      total_remaining_minutes: totalMinutes,
      push_notification_preview: {
        title: 'MyBrain: Esti AI Review (20:00)',
        body: `${items.length} feladat maradt: ${items.map(i => `${i.task.title.slice(0, 20)}... (${i.estimated_time_minutes}m)`).join(', ')}`,
      },
    };
  }
}
