import Bookmarks from '../Bookmarks';
import styles from '../../styles/Pages.module.css';

export default function Index() {
  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <h1 className={styles.title}>Simple Notes</h1>
        <Bookmarks />
      </main>
    </div>
  );
}
