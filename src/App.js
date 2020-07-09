import React, {useEffect, useRef, useState} from 'react';
import './App.css';
import {LeftPanel} from './LeftPanel';
import {FileBlock} from './FileBlock';
import {useIsMobile} from './hooks/useIsMobile';
import useIPFS from './hooks/useIPFS';
import OrbitDB from 'orbit-db';
import Sailplane from '@cypsela/sailplane-node';
import {LoadingRightBlock} from './LoadingRightBlock';
import {hot} from 'react-hot-loader';
import {Settings} from './Settings';
import {Instances} from './Instances';
import {useDispatch, useSelector} from 'react-redux';
import {addInstance} from './actions/main';
import {setStatus} from './actions/tempData';
import usePrevious from './hooks/usePrevious';
import {ContextMenu} from './ContextMenu';
import {delay} from './utils/Utils';
import all from 'it-all';

function App() {
  const isMobile = useIsMobile();
  const ipfsObj = useIPFS();
  const sailplaneRef = useRef(null);
  const [nodeReady, setNodeReady] = useState(false);
  const sharedFS = useRef({});
  const [ready, setReady] = useState(false);
  const [directoryContents, setDirectoryContents] = useState([]);
  const [currentDirectory, setCurrentDirectory] = useState('/r');
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  const [currentRightPanel, setCurrentRightPanel] = useState('files');

  const dispatch = useDispatch();
  const {instances, instanceIndex} = useSelector((state) => state.main);
  const currentInstance = instances[instanceIndex];
  const prevInstanceIndex = usePrevious(instanceIndex);

  const styles = {
    container: {
      position: 'relative',
      display: isMobile ? 'block' : 'flex',
      flexDirection: 'row',
      height: '100%',
    },
  };

  useEffect(() => {
    const rootLS = async () => {
      if (ready) {
        const contents = sharedFS.current.fs
          .ls(currentDirectory)
          .map((path) => {
            const type = sharedFS.current.fs.content(path);
            const pathSplit = path.split('/');
            const name = pathSplit[pathSplit.length - 1];

            return {path, name, type};
          });

        setDirectoryContents(contents);
      }
    };

    rootLS();
  }, [ready, currentDirectory, lastUpdateTime]);

  useEffect(() => {
    const switchInstance = async (doLS) => {
      console.log('switch');
      dispatch(setStatus({message: 'Initializing'}));
      let address;
      const sailplane = sailplaneRef.current;

      if (instances.length) {
        address = currentInstance.address;
      } else {
        const defaultOptions = {meta: 'superdrive'};
        address = await sailplane.determineAddress('main', defaultOptions);
        dispatch(addInstance(address.path, address.toString()));
      }

      const sfs =
        sailplane.mounted[address.toString()] ||
        (await sailplane.mount(address, {autoStart: false}));

      const onProgress = (key) => (current, max) => {
        dispatch(setStatus({message: `[${current}/${max}] ${key}`}));
        if (current === max) {
          delay(2000).then(() => dispatch(setStatus({})));
        }
      };

      const onLoad = onProgress('Loading');
      sfs.events.on('db.load.progress', onLoad);

      const onReplicate = onProgress('Replicating');
      sfs.events.on('db.replicate.progress', onReplicate);

      const onUpdated = () => setLastUpdateTime(Date.now());
      sfs.events.on('updated', onUpdated);

      sfs.tearDown = () => {
        sfs.events.removeListener('db.load.progress', onLoad);
        sfs.events.removeListener('db.replicate.progress', onReplicate);
        sfs.events.removeListener('updated', onUpdated);
      };

      if (sharedFS.current.tearDown) {
        sharedFS.current.tearDown();
      }

      if (!sfs.running) {
        await sfs.start();
      }

      sharedFS.current = sfs;

      if (doLS) {
        setCurrentDirectory('/r');
        setLastUpdateTime(Date.now());
      } else {
        setReady(true);
      }

      dispatch(setStatus({}));
    };

    if (nodeReady) {
      switchInstance(prevInstanceIndex !== instanceIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeReady, instanceIndex, instances]);

  useEffect(() => {
    const connectSailplane = async (ipfs) => {
      dispatch(setStatus({message: 'Connecting'}));
      const orbitdb = await OrbitDB.createInstance(ipfs);
      const sailplane = await Sailplane.create(orbitdb);

      sailplaneRef.current = sailplane;
      setNodeReady(true);
      dispatch(setStatus({}));

      window.sailplane = sailplane;
      window.all = all;
    };

    if (ipfsObj.isIpfsReady) {
      connectSailplane(ipfsObj.ipfs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipfsObj.ipfs, ipfsObj.isIpfsReady]);

  const getRightPanel = () => {
    if (currentRightPanel === 'files') {
      return (
        <FileBlock
          sharedFs={sharedFS}
          ipfs={ipfsObj.ipfs}
          directoryContents={directoryContents}
          setCurrentDirectory={setCurrentDirectory}
          currentDirectory={currentDirectory}
        />
      );
    } else if (currentRightPanel === 'settings') {
      return <Settings />;
    } else if (currentRightPanel === 'instances') {
      return <Instances sailplane={sailplaneRef.current} />;
    }
  };

  return (
    <div style={styles.container}>
      <LeftPanel
        setCurrentRightPanel={setCurrentRightPanel}
        currentRightPanel={currentRightPanel}
      />

      {ready ? getRightPanel() : <LoadingRightBlock />}
      <ContextMenu />
    </div>
  );
}

export default hot(module)(App);
