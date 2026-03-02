import { useState } from 'react';
import {
    CheckCircle2,
    Circle,
    Trash2,
    Plus
} from 'lucide-react';
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    orderBy,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { COLLECTIONS } from '@/config/constants';
import { useCollection } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import type { AppTask } from '@/types';

export function TasksList() {
    const { userProfile, user } = useAuth();
    const firmId = userProfile?.firmId;

    const { data: tasks, loading } = useCollection<AppTask>(
        firmId ? COLLECTIONS.TASKS(firmId) : null,
        [orderBy('createdAt', 'desc')]
    );

    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleAddTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskTitle.trim() || !firmId || !user) return;

        setIsSubmitting(true);
        try {
            const taskData: Omit<AppTask, 'id'> = {
                firmId,
                title: newTaskTitle.trim(),
                status: 'todo',
                createdAt: serverTimestamp() as Timestamp,
                updatedAt: serverTimestamp() as Timestamp,
                createdBy: user.uid,
                updatedBy: user.uid,
                assignedTo: user.uid,
            };

            await addDoc(collection(db, COLLECTIONS.TASKS(firmId)), taskData);
            setNewTaskTitle('');
        } catch (error) {
            console.error('Error adding task:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const toggleTaskStatus = async (task: AppTask) => {
        if (!firmId) return;

        const newStatus = task.status === 'completed' ? 'todo' : 'completed';
        const taskRef = doc(db, COLLECTIONS.TASKS(firmId), task.id);

        try {
            await updateDoc(taskRef, {
                status: newStatus,
                updatedAt: serverTimestamp(),
                completedAt: newStatus === 'completed' ? serverTimestamp() : null,
            });
        } catch (error) {
            console.error('Error toggling task status:', error);
        }
    };

    const deleteTask = async (taskId: string) => {
        if (!firmId) return;

        try {
            await deleteDoc(doc(db, COLLECTIONS.TASKS(firmId), taskId));
        } catch (error) {
            console.error('Error deleting task:', error);
        }
    };

    // Split tasks
    const activeTasks = tasks?.filter(t => t.status !== 'completed') || [];
    const completedTasks = tasks?.filter(t => t.status === 'completed') || [];

    return (
        <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* Header */}
            <div className="border-b border-gray-100 bg-[#1a365d]/[0.03] px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">My Tasks</h2>
                <p className="text-sm text-gray-500">Track internal to-dos and follow-ups</p>
            </div>

            {/* List Area */}
            <div className="flex-1 overflow-y-auto p-2 space-y-4">
                {loading ? (
                    <div className="p-4 space-y-3">
                        <div className="h-10 animate-pulse rounded bg-gray-100" />
                        <div className="h-10 animate-pulse rounded bg-gray-100" />
                    </div>
                ) : tasks?.length === 0 ? (
                    <div className="flex h-32 flex-col items-center justify-center text-center px-4">
                        <div className="rounded-full bg-blue-50 p-3 mb-2">
                            <CheckCircle2 className="h-6 w-6 text-blue-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-900">All caught up!</p>
                        <p className="text-xs text-gray-500 mt-0.5">Add a task below to get started.</p>
                    </div>
                ) : (
                    <div className="space-y-6 px-4 py-2">

                        {/* Active Tasks */}
                        {activeTasks.length > 0 && (
                            <ul className="space-y-2">
                                {activeTasks.map(task => (
                                    <li
                                        key={task.id}
                                        className="group flex items-start gap-3 rounded-lg border border-transparent p-2 transition-colors hover:bg-gray-50 hover:border-gray-100"
                                    >
                                        <button
                                            onClick={() => toggleTaskStatus(task)}
                                            className="mt-0.5 shrink-0 text-gray-300 hover:text-blue-600 transition-colors"
                                        >
                                            <Circle className="h-5 w-5" />
                                        </button>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-800">{task.title}</p>
                                        </div>
                                        <button
                                            onClick={() => deleteTask(task.id)}
                                            className="shrink-0 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {/* Completed Tasks */}
                        {completedTasks.length > 0 && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="h-px flex-1 bg-gray-100"></span>
                                    <span className="text-xs font-medium uppercase tracking-wider text-gray-400">Completed ({completedTasks.length})</span>
                                    <span className="h-px flex-1 bg-gray-100"></span>
                                </div>
                                <ul className="space-y-2 opacity-60">
                                    {completedTasks.map(task => (
                                        <li
                                            key={task.id}
                                            className="group flex items-start gap-3 rounded-lg p-2"
                                        >
                                            <button
                                                onClick={() => toggleTaskStatus(task)}
                                                className="mt-0.5 shrink-0 text-emerald-500 hover:text-gray-400 transition-colors"
                                            >
                                                <CheckCircle2 className="h-5 w-5" />
                                            </button>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-500 line-through">{task.title}</p>
                                            </div>
                                            <button
                                                onClick={() => deleteTask(task.id)}
                                                className="shrink-0 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="border-t border-gray-100 bg-gray-50 p-4">
                <form onSubmit={handleAddTask} className="flex items-center gap-2">
                    <input
                        type="text"
                        placeholder="Add a new task..."
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        disabled={isSubmitting}
                        className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                    />
                    <Button
                        type="submit"
                        disabled={!newTaskTitle.trim() || isSubmitting}
                        size="sm"
                        className="shrink-0 bg-[#1a365d] text-white hover:bg-[#2d4a7a] transition-colors shadow-sm gap-1.5 h-[38px]"
                    >
                        <Plus className="h-4 w-4" />
                        Add
                    </Button>
                </form>
            </div>
        </div>
    );
}
